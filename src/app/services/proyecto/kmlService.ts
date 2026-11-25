import { Injectable } from '@angular/core';
import { ProyectoFigura } from '../../models/gis';

export interface ArchivoEspacialParseado {
  nombre: string;
  tipo: string;
  features: any[];
}

@Injectable({
  providedIn: 'root',
})
export class KmlService {
  /** Exporta las figuras de un proyecto a un archivo .geojson descargable. */
  exportarGeoJson(nombreProyecto: string, figuras: ProyectoFigura[]): void {
    const features = figuras
      .map((f) => {
        const coordsParsed = this.parseCoordenadas(f.coordenadas);
        let geometry: any = null;

        if (f.tipo === 'poligono') {
          const ring = this.formatGeoJsonRing(coordsParsed);
          if (ring.length > 0) {
            this.cerrarAnillo(ring);
            geometry = { type: 'Polygon', coordinates: [ring] };
          }
        } else if (f.tipo === 'ruta') {
          const line = this.formatGeoJsonRing(coordsParsed);
          if (line.length > 0) {
            geometry = { type: 'LineString', coordinates: line };
          }
        } else if (f.tipo === 'circulo' && f.radio) {
          const ring = this.generarPoligonoCirculo(coordsParsed, f.radio);
          if (ring.length > 0) {
            geometry = { type: 'Polygon', coordinates: [ring] };
          }
        }

        return {
          type: 'Feature',
          properties: {
            id: f.id,
            nombre: f.nombre,
            tipo: f.tipo,
            color: f.color,
            radio: f.radio,
          },
          geometry,
        };
      })
      .filter((feature) => feature.geometry !== null);

    const featureCollection = {
      type: 'FeatureCollection',
      name: nombreProyecto,
      features,
    };

    const slug = nombreProyecto.toLowerCase().replace(/\s+/g, '-');
    this.descargarArchivo(
      'data:text/json;charset=utf-8,' + encodeURIComponent(JSON.stringify(featureCollection, null, 2)),
      `${slug}.geojson`,
    );
  }

  /** Exporta las figuras de un proyecto a un archivo .kml descargable para Google Earth. */
  exportarKml(nombreProyecto: string, figuras: ProyectoFigura[]): void {
    let kmlContent = `<?xml version="1.0" encoding="UTF-8"?>
<kml xmlns="http://www.opengis.net/kml/2.2">
  <Document>
    <name>${nombreProyecto}</name>
    <description>Proyecto exportado desde GeoProyect</description>
`;

    figuras.forEach((f) => {
      const coordsParsed = this.parseCoordenadas(f.coordenadas);
      const colorHex = f.color || '#4f46e5';
      const r = colorHex.substring(1, 3);
      const g = colorHex.substring(3, 5);
      const b = colorHex.substring(5, 7);
      const kmlLineColor = `ff${b}${g}${r}`;
      const kmlFillColor = `66${b}${g}${r}`;

      kmlContent += `    <Style id="style_${f.id}">
      <LineStyle>
        <color>${kmlLineColor}</color>
        <width>3</width>
      </LineStyle>
      <PolyStyle>
        <color>${kmlFillColor}</color>
      </PolyStyle>
    </Style>
`;

      kmlContent += `    <Placemark>
      <name>${f.nombre}</name>
      <styleUrl>#style_${f.id}</styleUrl>
      <description>Tipo: ${f.tipo} ${f.radio ? '| Radio: ' + Math.round(f.radio) + 'm' : ''}</description>
`;

      if (f.tipo === 'poligono') {
        const ring = this.formatGeoJsonRing(coordsParsed);
        if (ring.length > 0) {
          this.cerrarAnillo(ring);
          const coordString = ring.map((pt) => `${pt[0]},${pt[1]},0`).join(' ');
          kmlContent += `      <Polygon>
        <outerBoundaryIs>
          <LinearRing>
            <coordinates>${coordString}</coordinates>
          </LinearRing>
        </outerBoundaryIs>
      </Polygon>
`;
        }
      } else if (f.tipo === 'ruta') {
        const line = this.formatGeoJsonRing(coordsParsed);
        if (line.length > 0) {
          const coordString = line.map((pt) => `${pt[0]},${pt[1]},0`).join(' ');
          kmlContent += `      <LineString>
        <coordinates>${coordString}</coordinates>
      </LineString>
`;
        }
      } else if (f.tipo === 'circulo' && f.radio) {
        const ring = this.generarPoligonoCirculo(coordsParsed, f.radio);
        if (ring.length > 0) {
          const coordString = ring.map((pt) => `${pt[0]},${pt[1]},0`).join(' ');
          kmlContent += `      <Polygon>
        <outerBoundaryIs>
          <LinearRing>
            <coordinates>${coordString}</coordinates>
          </LinearRing>
        </outerBoundaryIs>
      </Polygon>
`;
        }
      }

      kmlContent += `    </Placemark>
`;
    });

    kmlContent += `  </Document>
</kml>`;

    const slug = nombreProyecto.toLowerCase().replace(/\s+/g, '-');
    this.descargarArchivo(
      'data:application/vnd.google-earth.kml+xml;charset=utf-8,' + encodeURIComponent(kmlContent),
      `${slug}.kml`,
    );
  }

  /** Parsea el contenido de un archivo .kml, .geojson o .json a un arreglo de Features GeoJSON. */
  parsearArchivoEspacial(nombreArchivo: string, contenidoTexto: string): ArchivoEspacialParseado {
    const extension = nombreArchivo.substring(nombreArchivo.lastIndexOf('.')).toLowerCase();
    if (extension !== '.geojson' && extension !== '.kml' && extension !== '.json') {
      throw new Error('Formato no soportado. Suba archivos .geojson o .kml.');
    }

    let geoJsonParsed: any;
    if (extension === '.kml') {
      geoJsonParsed = this.parseKmlToGeoJson(contenidoTexto);
    } else {
      geoJsonParsed = JSON.parse(contenidoTexto);
      if (geoJsonParsed.type !== 'FeatureCollection') {
        if (geoJsonParsed.type === 'Feature') {
          geoJsonParsed = { type: 'FeatureCollection', features: [geoJsonParsed] };
        } else {
          throw new Error('Estructura GeoJSON inválida.');
        }
      }
    }

    if (!geoJsonParsed?.features?.length) {
      throw new Error('El archivo no contiene elementos espaciales válidos.');
    }

    return {
      nombre: nombreArchivo,
      tipo: extension === '.kml' ? 'Google Earth (.kml)' : 'GeoJSON (.geojson)',
      features: geoJsonParsed.features,
    };
  }

  private parseCoordenadas(coordenadas: any): any {
    try {
      return typeof coordenadas === 'string' ? JSON.parse(coordenadas) : coordenadas;
    } catch {
      return coordenadas;
    }
  }

  private cerrarAnillo(ring: number[][]): void {
    if (
      ring.length > 0 &&
      (ring[0][0] !== ring[ring.length - 1][0] || ring[0][1] !== ring[ring.length - 1][1])
    ) {
      ring.push([ring[0][0], ring[0][1]]);
    }
  }

  private descargarArchivo(dataUri: string, filename: string): void {
    const downloadAnchor = document.createElement('a');
    downloadAnchor.setAttribute('href', dataUri);
    downloadAnchor.setAttribute('download', filename);
    document.body.appendChild(downloadAnchor);
    downloadAnchor.click();
    downloadAnchor.remove();
  }

  private generarPoligonoCirculo(
    centro: { lat: number; lng: number },
    radioMetros: number,
  ): number[][] {
    const puntos: number[][] = [];
    const numPuntos = 64;
    const earthRadius = 6378137;

    for (let i = 0; i <= numPuntos; i++) {
      const angle = (i * 2 * Math.PI) / numPuntos;
      const dLat = (radioMetros / earthRadius) * (180 / Math.PI);
      const dLng =
        (radioMetros / (earthRadius * Math.cos((centro.lat * Math.PI) / 180))) * (180 / Math.PI);

      puntos.push([
        centro.lng + dLng * Math.cos(angle),
        centro.lat + dLat * Math.sin(angle),
      ]);
    }
    return puntos;
  }

  private formatGeoJsonRing(coords: any): number[][] {
    if (!Array.isArray(coords)) return [];
    const actualCoords =
      Array.isArray(coords[0]) &&
      !('lat' in coords[0]) &&
      !('lng' in coords[0]) &&
      coords[0].length > 1
        ? coords[0]
        : coords;

    return actualCoords
      .map((pt: any) => this.toLngLatArray(pt) || [0, 0])
      .filter((pt) => pt[0] !== 0 || pt[1] !== 0);
  }

  private toLngLatArray(pt: any): number[] | null {
    if (!pt) return null;
    if (typeof pt === 'object' && !Array.isArray(pt)) {
      const lat = pt.lat !== undefined ? pt.lat : pt.latitud;
      const lng = pt.lng !== undefined ? pt.lng : pt.longitud;
      if (lat !== undefined && lng !== undefined) {
        return [Number(lng), Number(lat)];
      }
    }
    if (Array.isArray(pt) && pt.length >= 2) {
      return [Number(pt[1]), Number(pt[0])];
    }
    return null;
  }

  private parseKmlToGeoJson(kmlText: string): any {
    const parser = new DOMParser();
    const xmlDoc = parser.parseFromString(kmlText, 'text/xml');
    const placemarks = xmlDoc.getElementsByTagName('Placemark');
    const features: any[] = [];

    for (let i = 0; i < placemarks.length; i++) {
      const placemark = placemarks[i];
      const nameNode = placemark.getElementsByTagName('name')[0];
      const name = nameNode ? nameNode.textContent || `Elemento #${i + 1}` : `Elemento #${i + 1}`;

      let color = '#4f46e5';
      const styleUrlNode = placemark.getElementsByTagName('styleUrl')[0];
      if (styleUrlNode) {
        const styleId = styleUrlNode.textContent?.replace('#', '');
        if (styleId) {
          const styleNode = xmlDoc.getElementById(styleId);
          const lineColorNode = styleNode
            ?.getElementsByTagName('LineStyle')[0]
            ?.getElementsByTagName('color')[0];
          const kmlColor = lineColorNode?.textContent?.trim();
          if (kmlColor && kmlColor.length === 8) {
            color = `#${kmlColor.substring(6, 8)}${kmlColor.substring(4, 6)}${kmlColor.substring(2, 4)}`;
          }
        }
      }

      let geometry: any = null;
      let tipo = 'poligono';
      let radio: number | undefined = undefined;

      const polygonNode = placemark.getElementsByTagName('Polygon')[0];
      if (polygonNode) {
        const coordinatesNode = polygonNode.getElementsByTagName('coordinates')[0];
        if (coordinatesNode?.textContent) {
          const coords = this.parseKmlCoordinates(coordinatesNode.textContent);
          geometry = { type: 'Polygon', coordinates: [coords] };
          tipo = 'poligono';

          const descNode = placemark.getElementsByTagName('description')[0];
          const match = descNode?.textContent?.match(/Radio:\s*(\d+)m/);
          if (match) {
            tipo = 'circulo';
            radio = Number(match[1]);
          }
        }
      }

      const lineNode = placemark.getElementsByTagName('LineString')[0];
      if (lineNode && !geometry) {
        const coordinatesNode = lineNode.getElementsByTagName('coordinates')[0];
        if (coordinatesNode?.textContent) {
          const coords = this.parseKmlCoordinates(coordinatesNode.textContent);
          geometry = { type: 'LineString', coordinates: coords };
          tipo = 'ruta';
        }
      }

      const pointNode = placemark.getElementsByTagName('Point')[0];
      if (pointNode && !geometry) {
        const coordinatesNode = pointNode.getElementsByTagName('coordinates')[0];
        if (coordinatesNode?.textContent) {
          const coords = this.parseKmlCoordinates(coordinatesNode.textContent);
          if (coords.length > 0) {
            geometry = { type: 'Point', coordinates: coords[0] };
            tipo = 'punto';
          }
        }
      }

      if (geometry) {
        features.push({
          type: 'Feature',
          properties: { nombre: name, tipo, color, radio },
          geometry,
        });
      }
    }

    return { type: 'FeatureCollection', features };
  }

  private parseKmlCoordinates(coordsText: string): number[][] {
    const points = coordsText.trim().split(/\s+/);
    const coords: number[][] = [];
    points.forEach((p) => {
      const parts = p.split(',');
      if (parts.length >= 2) {
        const lng = Number(parts[0]);
        const lat = Number(parts[1]);
        if (!isNaN(lng) && !isNaN(lat)) {
          coords.push([lng, lat]);
        }
      }
    });
    return coords;
  }
}
