import { Injectable, inject } from '@angular/core';
import * as L from 'leaflet';
import { GisService as Gis } from '../gis/gisService';
import { GisMathService } from '../gis/gisMathService';
import { ElementService } from '../element/elementService';
import { ProyectoService } from '../proyecto/proyectoService';

export interface ParroquiaRef {
  name: string;
  municipio: string;
  estado: string;
}

@Injectable({
  providedIn: 'root',
})
export class MapAnalysisService {
  private gis = inject(Gis);
  private mathService = inject(GisMathService);
  private elementService = inject(ElementService);
  private proyectoService = inject(ProyectoService);

  /**
   * Analiza una figura dibujada/editada (polígono, ruta o círculo) y retorna métricas,
   * conteos, elementos contenidos/cercanos y recomendaciones.
   */
  analizarFigura(
    layer: L.Layer,
    esNueva: boolean,
    parroquiasGeoJsonData: any,
    onAsyncPolygonUpdate?: (analisisActualizado: any) => void,
  ): any {
    let tipo: 'poligono' | 'ruta' | 'circulo' = 'poligono';
    let vertices: L.LatLng[] = [];
    let area = 0;
    let perimetro = 0;
    let longitud = 0;
    let rumbo = 0;
    let cardinal = '';
    let centroCirculo: L.LatLng | null = null;
    let radioCirculo = 0;

    if (layer instanceof L.Circle) {
      tipo = 'circulo';
      centroCirculo = layer.getLatLng();
      radioCirculo = layer.getRadius();
      area = Math.PI * Math.pow(radioCirculo, 2);
      perimetro = 2 * Math.PI * radioCirculo;
    } else if (layer instanceof L.Polygon) {
      tipo = 'poligono';
      const latlngs = layer.getLatLngs();
      vertices = (Array.isArray(latlngs[0]) ? latlngs[0] : latlngs) as L.LatLng[];
      area = this.mathService.calcularAreaPoligono(vertices);
      perimetro = this.mathService.calcularPerimetroPoligono(vertices);
    } else if (layer instanceof L.Polyline) {
      tipo = 'ruta';
      vertices = layer.getLatLngs() as L.LatLng[];
      longitud = this.mathService.calcularLongitudRuta(vertices);
      if (vertices.length >= 2) {
        rumbo = this.mathService.calcularRumboInicial(vertices[0], vertices[vertices.length - 1]);
        cardinal = this.mathService.obtenerDireccionCardinal(rumbo);
      }
    }

    let centroide: L.LatLng | null = null;
    if (tipo === 'circulo' && centroCirculo) {
      centroide = centroCirculo;
    } else if (vertices.length > 0) {
      const latSum = vertices.reduce((sum, v) => sum + v.lat, 0);
      const lngSum = vertices.reduce((sum, v) => sum + v.lng, 0);
      centroide = L.latLng(latSum / vertices.length, lngSum / vertices.length);
    }

    const parroquiasFigura = this.obtenerParroquiasIntersectadas(
      layer,
      tipo,
      centroide,
      radioCirculo,
      parroquiasGeoJsonData,
    );
    const estadosFigura = Array.from(new Set(parroquiasFigura.map((p) => p.estado)));

    let bounds: L.LatLngBounds | null = null;
    if (typeof (layer as any).getBounds === 'function') {
      bounds = (layer as any).getBounds();
    }

    let radioBases: any[] = [];
    let agentes: any[] = [];
    let oficinas: any[] = [];

    if (tipo === 'circulo' && centroCirculo) {
      const enCirculo = (lista: any[]) =>
        lista.filter(
          (item) =>
            (!bounds || bounds.contains([item.latitud, item.longitud])) &&
            this.mathService.puntoEnCirculo(
              item.latitud,
              item.longitud,
              centroCirculo!,
              radioCirculo,
            ) &&
            !this.elementoEnOtrasFiguras(item.latitud, item.longitud, layer),
        );
      radioBases = enCirculo(this.gis.radioBasesSignal());
      agentes = enCirculo(this.gis.agentesSignal());
      oficinas = enCirculo(this.gis.oficinasSignal());
    } else if (tipo === 'ruta') {
      const bufferMetros = 500;
      const cercaDeRuta = (lista: any[]) =>
        lista.filter((item) =>
          this.mathService.puntoCercaDeRuta(item.latitud, item.longitud, vertices, bufferMetros),
        );
      radioBases = cercaDeRuta(this.gis.radioBasesSignal());
      agentes = cercaDeRuta(this.gis.agentesSignal());
      oficinas = cercaDeRuta(this.gis.oficinasSignal());
    }

    const totalAbonados = this.gis
      .abonadosSignal()
      .filter((ab) => estadosFigura.includes(ab.estado))
      .reduce((acc, curr) => acc + (Number(curr.cantidad) || 0), 0);

    const recomendaciones = this.calcularRecomendacionesAnalisis(
      radioBases.length,
      agentes.length,
      oficinas.length,
      tipo,
    );

    const analisis = {
      tipo,
      coordenadas: tipo === 'circulo' ? centroCirculo : vertices,
      radio: tipo === 'circulo' ? radioCirculo : null,
      esNueva,
      nombreExistente: (layer as any).dbFigura?.nombre || '',
      mediciones: { area, perimetro, longitud, rumbo, cardinal },
      conteos: {
        radioBases: radioBases.length,
        agentes: agentes.length,
        oficinas: oficinas.length,
        abonados: totalAbonados,
      },
      elementos: {
        radioBases,
        agentes,
        oficinas,
        abonados: this.gis.abonadosSignal().filter((ab) => estadosFigura.includes(ab.estado)),
      },
      recomendaciones,
    };

    if (tipo === 'poligono' && onAsyncPolygonUpdate) {
      const wkt = this.mathService.figurasToWKT([{ tipo: 'poligono', layer }]);
      if (wkt) {
        this.elementService.filtrarPorPoligonos(wkt).subscribe((elementos: any[]) => {
          const sinDuplicar = (tipoEl: string) =>
            elementos.filter(
              (e: any) =>
                e.tipo === tipoEl && !this.elementoEnOtrasFiguras(e.latitud, e.longitud, layer),
            );
          const radioBasesSync = sinDuplicar('antenas');
          const agentesSync = sinDuplicar('agentes');
          const oficinasSync = sinDuplicar('oficinas');

          onAsyncPolygonUpdate({
            ...analisis,
            elementos: {
              ...analisis.elementos,
              radioBases: radioBasesSync,
              agentes: agentesSync,
              oficinas: oficinasSync,
            },
          });
        });
      }
    }

    return analisis;
  }

  private obtenerParroquiaPorCoordenada(
    lat: number,
    lng: number,
    parroquiasGeoJsonData: any,
  ): ParroquiaRef | null {
    if (!parroquiasGeoJsonData) return null;
    for (const feature of parroquiasGeoJsonData.features) {
      const geom = feature.geometry;
      if (!geom) continue;

      const { type, coordinates: coords } = geom;
      const name = feature.properties.adm3_name;
      const municipio = feature.properties.adm2_name;
      const estado = feature.properties.adm1_name;

      const puntoEnGeoJsonPoligono = (ring: number[][]) => {
        const polyVertices = ring.map((p) => L.latLng(p[1], p[0]));
        return this.mathService.puntoEnPoligono(lat, lng, polyVertices);
      };

      try {
        if (type === 'Polygon') {
          if (puntoEnGeoJsonPoligono(coords[0])) return { name, municipio, estado };
        } else if (type === 'MultiPolygon') {
          for (const poly of coords) {
            if (puntoEnGeoJsonPoligono(poly[0])) return { name, municipio, estado };
          }
        }
      } catch {}
    }
    return null;
  }

  private obtenerParroquiasIntersectadas(
    layer: any,
    tipo: string,
    centro: L.LatLng | null,
    radio: number,
    parroquiasGeoJsonData: any,
  ): ParroquiaRef[] {
    const keySet = new Set<string>();
    const parroquias: ParroquiaRef[] = [];

    const addPar = (par: ParroquiaRef | null) => {
      if (!par) return;
      const key = `${par.name}_${par.estado}`;
      if (!keySet.has(key)) {
        keySet.add(key);
        parroquias.push(par);
      }
    };

    if (centro) {
      addPar(this.obtenerParroquiaPorCoordenada(centro.lat, centro.lng, parroquiasGeoJsonData));
    }

    if (typeof layer.getBounds !== 'function') return parroquias;
    const bounds = layer.getBounds();
    if (!bounds || !bounds.isValid()) return parroquias;

    const latStep = (bounds.getNorth() - bounds.getSouth()) / 4;
    const lngStep = (bounds.getEast() - bounds.getWest()) / 4;

    for (let i = 0; i <= 4; i++) {
      for (let j = 0; j <= 4; j++) {
        const lat = bounds.getSouth() + i * latStep;
        const lng = bounds.getWest() + j * lngStep;

        let pointInside = false;
        if (tipo === 'circulo' && centro) {
          pointInside = this.mathService.puntoEnCirculo(lat, lng, centro, radio);
        } else if (tipo === 'poligono') {
          const latlngs = layer.getLatLngs();
          const vertices = (Array.isArray(latlngs[0]) ? latlngs[0] : latlngs) as L.LatLng[];
          pointInside = this.mathService.puntoEnPoligono(lat, lng, vertices);
        } else if (tipo === 'ruta') {
          const vertices = layer.getLatLngs() as L.LatLng[];
          pointInside = this.mathService.puntoCercaDeRuta(lat, lng, vertices, 500);
        }

        if (pointInside) {
          addPar(this.obtenerParroquiaPorCoordenada(lat, lng, parroquiasGeoJsonData));
        }
      }
    }

    return parroquias;
  }

  private elementoEnOtrasFiguras(lat: number, lng: number, layerActual: L.Layer): boolean {
    const figuras = this.proyectoService.figurasProyectoActivo();
    const idActual = (layerActual as any).dbFigura?.id;
    const otrasFiguras = figuras.filter((f) => f.id !== idActual);

    for (const f of otrasFiguras) {
      if (!f.coordenadas) continue;
      let coords: any;
      try {
        coords = typeof f.coordenadas === 'string' ? JSON.parse(f.coordenadas) : f.coordenadas;
      } catch {
        continue;
      }

      if (f.tipo === 'circulo' && f.radio) {
        const cLat =
          coords.lat !== undefined ? coords.lat : Array.isArray(coords) ? coords[0] : undefined;
        const cLng =
          coords.lng !== undefined ? coords.lng : Array.isArray(coords) ? coords[1] : undefined;
        if (
          cLat !== undefined &&
          cLng !== undefined &&
          this.mathService.puntoEnCirculo(lat, lng, L.latLng(cLat, cLng), f.radio)
        ) {
          return true;
        }
      } else if (f.tipo === 'poligono') {
        const verticesRaw =
          Array.isArray(coords[0]) && Array.isArray(coords[0][0]) ? coords[0] : coords;
        if (Array.isArray(verticesRaw)) {
          const vertices = verticesRaw.map((v: any) =>
            L.latLng(v.lat !== undefined ? v.lat : v[0], v.lng !== undefined ? v.lng : v[1]),
          );
          if (this.mathService.puntoEnPoligono(lat, lng, vertices)) return true;
        }
      }
    }
    return false;
  }

  private calcularRecomendacionesAnalisis(
    radiobasesLocales: number,
    agentes: number,
    oficinas: number,
    tipo: 'poligono' | 'ruta' | 'circulo',
  ): any {
    const localSugerencias: string[] = [];
    const sufijo =
      tipo === 'poligono' || tipo === 'circulo'
        ? 'dentro del área'
        : 'en la proximidad de la ruta';
    const radiobasesRequeridas = oficinas + Math.ceil(agentes / 3);

    if (radiobasesRequeridas === 0) {
      if (radiobasesLocales === 0) {
        localSugerencias.push(
          `📡 Cobertura de Radiobases: Se detectaron 0 radiobases ${sufijo}. Sugerencia: Evaluar el despliegue de una nueva antena si la zona presenta baja cobertura.`,
        );
      } else if (radiobasesLocales === 1) {
        localSugerencias.push(
          `📡 Cobertura de Radiobases: Se detectó 1 radiobase ${sufijo}, brindando cobertura directa a este sector.`,
        );
      } else {
        localSugerencias.push(
          `📡 Cobertura de Radiobases: Se detectaron ${radiobasesLocales} radiobases ${sufijo}, asegurando cobertura local.`,
        );
      }
    } else if (radiobasesLocales === 0) {
      localSugerencias.push(
        `🚨 Alerta de Capacidad: Se detectó alta actividad comercial (${oficinas} oficina(s) / ${agentes} agente(s)) pero 0 radiobases locales. Sugerencia: Instalar de forma prioritaria al menos ${radiobasesRequeridas} radiobase(s) para dar soporte al canal de ventas y atención.`,
      );
    } else if (radiobasesLocales < radiobasesRequeridas) {
      localSugerencias.push(
        `⚠️ Insuficiencia de Red: Se cuenta con ${radiobasesLocales} radiobase(s) para una demanda comercial estimada de ${radiobasesRequeridas} antenas. Sugerencia: Desplegar ${radiobasesRequeridas - radiobasesLocales} nueva(s) radiobase(s) para evitar congestión en los puntos de venta y oficinas.`,
      );
    } else {
      localSugerencias.push(
        `📡 Cobertura de Radiobases: Se detectaron ${radiobasesLocales} radiobases locales, lo cual es óptimo para soportar la carga de la infraestructura comercial del área (${radiobasesRequeridas} recomendada(s)).`,
      );
    }

    if (oficinas === 0) {
      localSugerencias.push(
        `🏢 Atención Comercial: Se detectaron 0 oficinas ${sufijo}. Sugerencia: Instalar 1 Oficina de Atención en esta zona.`,
      );
    } else {
      localSugerencias.push(
        `🏢 Atención Comercial: Se detectaron ${oficinas} oficinas ${sufijo}, cubriendo la atención al cliente de la zona.`,
      );
    }

    if (agentes === 0) {
      localSugerencias.push(
        `🛍️ Red de Ventas: Se detectaron 0 agentes autorizados en los límites del dibujo. Sugerencia: Certificar 2 nuevos agentes comerciales en este sector.`,
      );
    } else if (agentes < 3) {
      localSugerencias.push(
        `🛍️ Red de Ventas: Se detectaron ${agentes} agentes autorizados. Sugerencia: Certificar al menos ${3 - agentes} nuevos agentes comerciales para fortalecer la presencia.`,
      );
    } else {
      localSugerencias.push(
        `🛍️ Red de Ventas: Presencia comercial sólida con ${agentes} agentes autorizados en los límites del dibujo.`,
      );
    }

    return {
      estadal: null,
      local: {
        titulo: 'Métrica Local (Dentro del Polígono Dibujado)',
        sugerencias: localSugerencias,
      },
    };
  }
}
