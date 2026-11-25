import { Injectable, inject } from '@angular/core';
import * as L from 'leaflet';
import { TipoElemento } from '../../models/gis';
import { GisService as Gis } from '../gis/gisService';
import { ElementRendererService } from '../element/elementRendererService';

export interface MarkerRenderContext {
  map: L.Map;
  layerAggregated: L.LayerGroup;
  groups: {
    radioBases: L.LayerGroup;
    oficinas: L.LayerGroup;
    agentes: L.LayerGroup;
    abonados: L.LayerGroup;
  };
  analisisFigura: any;
  proyectoElementosFiltrados: { radioBases: any[]; oficinas: any[]; agentes: any[] } | null;
}

@Injectable({
  providedIn: 'root',
})
export class MapMarkerService {
  private gis = inject(Gis);
  private renderer = inject(ElementRendererService);

  renderParroquiaTotals(
    tipos: TipoElemento[],
    parroquiasGeoJsonData: any,
    parroquiaCentros: Record<string, L.LatLng>,
    map: L.Map,
    layerAggregated: L.LayerGroup,
  ): void {
    if (!parroquiasGeoJsonData) return;

    const renderedPoints: L.Point[] = [];
    const renderedKeys = new Set<string>();
    const coordsPorParroquia = this.indexarCentrosPorParroquia(tipos);

    parroquiasGeoJsonData.features.forEach((f: any) => {
      const pName = f.properties.adm3_name;
      const estado = f.properties.adm1_name;
      const uniqueKey = `${pName}_${estado}`;

      if (renderedKeys.has(uniqueKey)) return;
      renderedKeys.add(uniqueKey);

      const centro = coordsPorParroquia.get(uniqueKey) || parroquiaCentros[uniqueKey];
      if (!centro) return;

      const items = tipos
        .map((t) => ({ tipo: t, total: this.gis.getTotalesPorParroquia(t).get(uniqueKey) || 0 }))
        .filter((i) => i.total > 0);
      if (items.length === 0) return;

      const { segBreakdown, agenteBreakdown } = this.calcularDesgloses(
        tipos,
        (ab) => ab.parroquia === pName && ab.estado === estado,
        (ag) => ag.parroquia === pName && ag.estado === estado,
      );

      this.agregarBadgeSinColision(
        map,
        layerAggregated,
        centro,
        renderedPoints,
        items,
        'parroquia',
        `${pName} (${estado})`,
        'estado',
        segBreakdown,
        agenteBreakdown,
        { minDistance: 35, baseRadius: 10, stepRadius: 3, maxAttempts: 10, baseZIndex: 1500 },
      );
    });
  }

  renderStateTotals(tipos: TipoElemento[], map: L.Map, layerAggregated: L.LayerGroup): void {
    const renderedPoints: L.Point[] = [];

    this.gis.estadosSignal().forEach((est) => {
      const items = tipos
        .map((t) => ({ tipo: t, total: this.gis.getTotalesPorEstado(t).get(est.nombre) || 0 }))
        .filter((i) => i.total > 0);
      if (items.length === 0) return;

      const { segBreakdown, agenteBreakdown } = this.calcularDesgloses(
        tipos,
        (ab) => ab.estado === est.nombre,
        (ag) => ag.estado === est.nombre,
      );

      this.agregarBadgeSinColision(
        map,
        layerAggregated,
        L.latLng(est.latitud, est.longitud),
        renderedPoints,
        items,
        'estado',
        est.nombre,
        'estado',
        segBreakdown,
        agenteBreakdown,
        { minDistance: 45, baseRadius: 12, stepRadius: 3, maxAttempts: 15, baseZIndex: 1000 },
      );
    });
  }

  renderRegionTotals(tipos: TipoElemento[], map: L.Map, layerAggregated: L.LayerGroup): void {
    const renderedPoints: L.Point[] = [];

    this.gis.regionesSignal().forEach((reg) => {
      const items = tipos
        .map((t) => ({ tipo: t, total: this.gis.getTotalesPorRegion(t).get(reg.nombre) || 0 }))
        .filter((i) => i.total > 0);
      const centro = this.gis.getCentroRegion(reg.nombre);
      if (items.length === 0 || !centro) return;

      const { segBreakdown, agenteBreakdown } = this.calcularDesgloses(
        tipos,
        (ab) => this.gis.obtenerRegion(ab.estado) === reg.nombre,
        (ag) => this.gis.obtenerRegion(ag.estado) === reg.nombre,
      );

      this.agregarBadgeSinColision(
        map,
        layerAggregated,
        L.latLng(centro.lat, centro.lng),
        renderedPoints,
        items,
        'region',
        reg.nombre,
        'region',
        segBreakdown,
        agenteBreakdown,
        { minDistance: 50, baseRadius: 15, stepRadius: 4, maxAttempts: 15, baseZIndex: 2000 },
      );
    });
  }

  renderIndividualMarkers(tipos: TipoElemento[], ctx: MarkerRenderContext): void {
    const { map, groups, analisisFigura: analisis, proyectoElementosFiltrados: proyFiltros } = ctx;
    const isFiltered =
      !!analisis &&
      (analisis.tipo === 'poligono' || analisis.tipo === 'circulo' || analisis.tipo === 'ruta');

    if (tipos.includes('antenas')) {
      const icon = this.renderer.crearPinIcon('antenas');
      const termino = this.gis.busquedaAntena().toLowerCase();
      const dataSource =
        isFiltered && analisis.elementos
          ? analisis.elementos.radioBases
          : proyFiltros
            ? proyFiltros.radioBases
            : this.gis.radioBasesSignal();

      dataSource
        .filter(
          (a: any) =>
            !termino ||
            a.nombre?.toLowerCase().includes(termino) ||
            a.direccion?.toLowerCase().includes(termino),
        )
        .forEach((a: any) => {
          if (a.latitud && a.longitud) {
            L.marker([a.latitud, a.longitud], { icon, pane: 'elementsPane' })
              .bindPopup(
                () =>
                  this.renderer.crearPopupDetalle('antenas', [
                    { label: 'Nombre', value: a.nombre },
                    {
                      label: 'Ubicación',
                      value: `${a.estado} (${this.gis.obtenerRegion(a.estado) || 'Sin región'})`,
                    },
                    { label: 'Tecnología', value: a.tecnologia },
                    {
                      label: 'Actividad',
                      value: a.actividad,
                      badge: true,
                      badgeColor: this.renderer.getColorActividad(a.actividad),
                    },
                    { label: 'Dirección', value: a.direccion },
                    {
                      label: 'Coordenadas',
                      value: this.renderer.formatCoords(a.latitud, a.longitud),
                      coords: true,
                    },
                  ]),
                { maxWidth: 400 },
              )
              .addTo(groups.radioBases);
          }
        });
      groups.radioBases.addTo(map);
    }

    if (tipos.includes('oficinas')) {
      const icon = this.renderer.crearPinIcon('oficinas');
      const dataSource =
        isFiltered && analisis.elementos
          ? analisis.elementos.oficinas
          : proyFiltros
            ? proyFiltros.oficinas
            : this.gis.oficinasSignal();

      dataSource.forEach((o: any) => {
        if (o.latitud && o.longitud) {
          L.marker([o.latitud, o.longitud], { icon, pane: 'elementsPane' })
            .bindPopup(
              () =>
                this.renderer.crearPopupDetalle('oficinas', [
                  { label: 'Nombre', value: o.nombre },
                  {
                    label: 'Ubicación',
                    value: `${o.estado} (${this.gis.obtenerRegion(o.estado) || 'Sin región'})`,
                  },
                  { label: 'Dirección', value: o.direccion },
                  {
                    label: 'Coordenadas',
                    value: this.renderer.formatCoords(o.latitud, o.longitud),
                    coords: true,
                  },
                ]),
              { maxWidth: 400 },
            )
            .addTo(groups.oficinas);
        }
      });
      groups.oficinas.addTo(map);
    }

    if (tipos.includes('agentes')) {
      const icon = this.renderer.crearPinIcon('agentes');
      const dataSource =
        isFiltered && analisis.elementos
          ? analisis.elementos.agentes
          : proyFiltros
            ? proyFiltros.agentes
            : this.gis.agentesSignal();

      dataSource.forEach((ag: any) => {
        if (ag.latitud && ag.longitud) {
          L.marker([ag.latitud, ag.longitud], { icon, pane: 'elementsPane' })
            .bindPopup(
              () =>
                this.renderer.crearPopupDetalle('agentes', [
                  { label: 'Nombre', value: ag.nombre },
                  {
                    label: 'Ubicación',
                    value: `${ag.estado} (${this.gis.obtenerRegion(ag.estado) || 'Sin región'})`,
                  },
                  { label: 'Cód. Dealer', value: ag.codigoDealer },
                  { label: 'Clasificación', value: ag.clasificacion, badge: true },
                  { label: 'Dirección', value: ag.direccion },
                  {
                    label: 'Coordenadas',
                    value: this.renderer.formatCoords(ag.latitud, ag.longitud),
                    coords: true,
                  },
                ]),
              { maxWidth: 400 },
            )
            .addTo(groups.agentes);
        }
      });
      groups.agentes.addTo(map);
    }

    if (tipos.includes('abonados')) {
      const icon = this.renderer.crearPinIcon('abonados');
      const grupos: Record<string, any> = {};
      const dataSource =
        isFiltered && analisis.elementos ? analisis.elementos.abonados : this.gis.abonadosSignal();

      dataSource.forEach((ab: any) => {
        const key = `${Number(ab.latitud).toFixed(5)}_${Number(ab.longitud).toFixed(5)}`;
        if (!grupos[key]) {
          grupos[key] = { ...ab, nombre: ab.nombre.replace(/ 3G| 4G| 5G/gi, ''), segs: {} };
        }
        grupos[key].segs[ab.segmentacion] =
          (grupos[key].segs[ab.segmentacion] || 0) + (Number(ab.cantidad) || 0);
      });

      Object.values(grupos).forEach((g) => {
        if (g.latitud && g.longitud) {
          L.marker([g.latitud, g.longitud], { icon, pane: 'elementsPane' })
            .bindPopup(
              () => {
                const total = Object.values(g.segs).reduce((a: any, b: any) => a + b, 0) as number;
                const rows: any[] = [
                  { label: 'Nombre', value: g.nombre },
                  {
                    label: 'Ubicación',
                    value: `${g.estado} (${this.gis.obtenerRegion(g.estado) || 'Sin región'})`,
                  },
                ];
                if (Object.keys(g.segs).length > 1) {
                  rows.push(
                    { label: 'Desglose', breakdown: g.segs },
                    { label: 'Total General', value: total.toLocaleString(), badge: true },
                  );
                } else {
                  const [s, c] = Object.entries(g.segs)[0];
                  rows.push(
                    { label: 'Segmentación', value: s, badge: true },
                    { label: 'Cantidad', value: (c as number).toLocaleString() },
                  );
                }
                if (g.direccion) rows.push({ label: 'Dirección', value: g.direccion });
                rows.push({
                  label: 'Coordenadas',
                  value: this.renderer.formatCoords(g.latitud, g.longitud),
                  coords: true,
                });
                return this.renderer.crearPopupDetalle('abonados', rows);
              },
              { maxWidth: 400 },
            )
            .addTo(groups.abonados);
        }
      });
      groups.abonados.addTo(map);
    }
  }

  /** Calcula el centroide real de los elementos dentro de cada parroquia para ubicar el badge cerca de ellos. */
  private indexarCentrosPorParroquia(tipos: TipoElemento[]): Map<string, L.LatLng> {
    const acumulados = new Map<string, { latSum: number; lngSum: number; count: number }>();

    const agregarLista = (lista: any[]) => {
      lista.forEach((item) => {
        const lat = Number(item.latitud);
        const lng = Number(item.longitud);
        if (!item.parroquia || !item.estado || !lat || !lng) return;
        const key = `${item.parroquia}_${item.estado}`;
        const prev = acumulados.get(key) || { latSum: 0, lngSum: 0, count: 0 };
        prev.latSum += lat;
        prev.lngSum += lng;
        prev.count += 1;
        acumulados.set(key, prev);
      });
    };

    if (tipos.includes('antenas')) agregarLista(this.gis.radioBasesSignal());
    if (tipos.includes('oficinas')) agregarLista(this.gis.oficinasSignal());
    if (tipos.includes('agentes')) agregarLista(this.gis.agentesSignal());
    if (tipos.includes('abonados')) agregarLista(this.gis.abonadosSignal());

    const centros = new Map<string, L.LatLng>();
    acumulados.forEach((v, k) => {
      centros.set(k, L.latLng(v.latSum / v.count, v.lngSum / v.count));
    });
    return centros;
  }

  private calcularDesgloses(
    tipos: TipoElemento[],
    filtroAbonado: (ab: any) => boolean,
    filtroAgente: (ag: any) => boolean,
  ): { segBreakdown: Record<string, number> | null; agenteBreakdown: Record<string, number> | null } {
    const segBreakdown = tipos.includes('abonados')
      ? this.gis
          .abonadosSignal()
          .filter(filtroAbonado)
          .reduce((acc: any, ab) => {
            acc[ab.segmentacion] = (acc[ab.segmentacion] || 0) + (Number(ab.cantidad) || 0);
            return acc;
          }, {})
      : null;

    const agenteBreakdown = tipos.includes('agentes')
      ? this.gis
          .agentesSignal()
          .filter(filtroAgente)
          .reduce((acc: any, ag) => {
            acc[ag.clasificacion || 'AA'] =
              (acc[ag.clasificacion || 'AA'] || 0) + (Number(ag.cantidad) || 1);
            return acc;
          }, {})
      : null;

    return { segBreakdown, agenteBreakdown };
  }

  private agregarBadgeSinColision(
    map: L.Map,
    layerAggregated: L.LayerGroup,
    centro: L.LatLng,
    renderedPoints: L.Point[],
    items: { tipo: TipoElemento; total: number }[],
    level: 'region' | 'estado' | 'parroquia',
    tituloPopup: string,
    tipoPopup: 'estado' | 'region',
    segBreakdown: Record<string, number> | null,
    agenteBreakdown: Record<string, number> | null,
    opts: {
      minDistance: number;
      baseRadius: number;
      stepRadius: number;
      maxAttempts: number;
      baseZIndex: number;
    },
  ): void {
    const originalPoint = map.latLngToLayerPoint(centro);
    let adjustedPoint = originalPoint;
    let attempts = 0;
    let angle = 0;
    let collision = true;

    while (collision && attempts < opts.maxAttempts) {
      collision = renderedPoints.some((p) => p.distanceTo(adjustedPoint) < opts.minDistance);
      if (collision) {
        attempts++;
        angle += 1.1;
        const radius = opts.baseRadius + attempts * opts.stepRadius;
        adjustedPoint = L.point(
          originalPoint.x + radius * Math.cos(angle),
          originalPoint.y + radius * Math.sin(angle),
        );
      }
    }

    renderedPoints.push(adjustedPoint);
    const finalLatLng = map.layerPointToLatLng(adjustedPoint);

    L.marker(finalLatLng, {
      icon: this.renderer.crearBadgeGroupIcon(items, level),
      zIndexOffset: opts.baseZIndex + attempts,
      pane: 'elementsPane',
    })
      .bindPopup(
        this.renderer.crearPopupAgregado(
          tituloPopup,
          tipoPopup,
          items,
          segBreakdown,
          agenteBreakdown,
        ),
      )
      .addTo(layerAggregated);
  }
}
