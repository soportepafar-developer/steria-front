import { inject, Injectable, computed } from '@angular/core';
import { CapasEstado, TipoElemento, Region } from '../../models/gis';
import { CoordService } from '../coord/coordService';
import { ElementService } from '../element/elementService';
import { MapStateService } from './mapStateService';
import { ConfigService } from '../config/configService';

@Injectable({ providedIn: 'root' })
export class MapService {
  private coord = inject(CoordService);
  private element = inject(ElementService);
  private state = inject(MapStateService);
  private config = inject(ConfigService);

  // Exponemos los signals del estado para que la fachada siga funcionando igual
  get capasVisibles() { return this.state.capasVisibles; }
  get zoomLevel() { return this.state.zoomLevel; }
  get sidebarColapsado() { return this.state.sidebarColapsado; }
  get busquedaAntena() { return this.state.busquedaAntena; }
  get moduloPoligonosActivo() { return this.state.moduloPoligonosActivo; }
  get modoDibujo() { return this.state.modoDibujo; }

  toggleModuloPoligonos() {
    const nuevo = !this.moduloPoligonosActivo();
    this.moduloPoligonosActivo.set(nuevo);
    if (!nuevo) {
      this.modoDibujo.set(null);
    }
  }

  setModoDibujo(modo: string | null) {
    this.modoDibujo.update(actual => actual === modo ? null : modo);
  }

  // Paleta de colores
  COLORES_REGIONES_SIGNAL = computed(() => {
    const mapping: Record<string, string> = {};
    this.regionesSignal().forEach(r => { mapping[r.nombre] = r.color; });
    return mapping;
  });

  // lista de regiones (prioriza el esquema activo configurado)
  regionesSignal = computed<Region[]>(() => {
    const esquema = this.config.esquemaActivo();
    if (esquema?.regiones?.length) {
      return esquema.regiones.map(r => ({ nombre: r.nombre, color: r.color }));
    }
    const unique = new Map<string, string>();
    this.element.estadosSignal().forEach(e => {
      if (e.nombre_region && e.color_region) unique.set(e.nombre_region, e.color_region);
    });
    return Array.from(unique.entries()).map(([nombre, color]) => ({ nombre, color }));
  });

  // Geografía
  obtenerRegion(nombreEstado: string): string {
    const esquema = this.config.esquemaActivo();
    if (esquema?.regiones?.length) {
      return this.config.getRegionDeEstado(nombreEstado) || '';
    }
    const fromDB = this.element.estadosSignal().find(e => e.nombre === nombreEstado);
    if (fromDB) return fromDB.nombre_region;
    return this.coord.getRegionDeEstado(nombreEstado);
  }

  getColorEstado(nombreEstado: string): string {
    const regionCfg = this.config.esquemaActivo()?.regiones.find(r => r.estados.includes(nombreEstado));
    if (regionCfg?.color) {
      const idx = regionCfg.estados.indexOf(nombreEstado);
      return this.generarTonoEstado(regionCfg.color, idx, regionCfg.estados.length);
    }
    const estado = this.element.estadosSignal().find(e => e.nombre === nombreEstado) as any;
    return estado?.color_estado || estado?.color_region || '#DEE2E6';
  }

  /** Genera un tono más claro u oscuro del color base de la región según el índice del estado. */
  private generarTonoEstado(hexBase: string, indice: number, total: number): string {
    if (total <= 1 || indice < 0) return hexBase;

    let clean = hexBase.replace('#', '').trim();
    if (clean.length === 3) {
      clean = clean.split('').map(c => c + c).join('');
    }
    if (clean.length !== 6) return hexBase;

    const r = parseInt(clean.slice(0, 2), 16) / 255;
    const g = parseInt(clean.slice(2, 4), 16) / 255;
    const b = parseInt(clean.slice(4, 6), 16) / 255;
    if (isNaN(r) || isNaN(g) || isNaN(b)) return hexBase;

    const max = Math.max(r, g, b);
    const min = Math.min(r, g, b);
    let h = 0;
    let s = 0;
    const l = (max + min) / 2;

    if (max !== min) {
      const d = max - min;
      s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
      switch (max) {
        case r: h = (g - b) / d + (g < b ? 6 : 0); break;
        case g: h = (b - r) / d + 2; break;
        case b: h = (r - g) / d + 4; break;
      }
      h /= 6;
    }

    // Distribuye tonos entre -16% (más oscuro) y +18% (más claro), manteniendo legibilidad
    const factor = indice / (total - 1) - 0.5; // [-0.5, +0.5]
    const lAjustado = Math.max(0.24, Math.min(0.80, l + factor * 0.34));

    const hue2rgb = (p: number, q: number, t: number) => {
      let tt = t;
      if (tt < 0) tt += 1;
      if (tt > 1) tt -= 1;
      if (tt < 1 / 6) return p + (q - p) * 6 * tt;
      if (tt < 1 / 2) return q;
      if (tt < 2 / 3) return p + (q - p) * (2 / 3 - tt) * 6;
      return p;
    };

    const q = lAjustado < 0.5 ? lAjustado * (1 + s) : lAjustado + s - lAjustado * s;
    const p = 2 * lAjustado - q;
    const toHex = (v: number) => Math.round(v * 255).toString(16).padStart(2, '0');

    const nr = s === 0 ? lAjustado : hue2rgb(p, q, h + 1 / 3);
    const ng = s === 0 ? lAjustado : hue2rgb(p, q, h);
    const nb = s === 0 ? lAjustado : hue2rgb(p, q, h - 1 / 3);

    return `#${toHex(nr)}${toHex(ng)}${toHex(nb)}`;
  }

  getCentroRegion(nombreRegion: string): { lat: number; lng: number } | null {
    const regionCfg = this.config.esquemaActivo()?.regiones.find(r => r.nombre === nombreRegion);
    if (regionCfg?.estados?.length) {
      const coords = regionCfg.estados
        .map(est => this.coord.getCoordEstado(est))
        .filter((c): c is { lat: number; lng: number } => !!c);
      if (coords.length > 0) {
        const lat = coords.reduce((a, c) => a + c.lat, 0) / coords.length;
        const lng = coords.reduce((a, c) => a + c.lng, 0) / coords.length;
        return { lat, lng };
      }
    }
    const estados = this.element.estadosSignal().filter(e => e.nombre_region === nombreRegion);
    if (estados.length > 0) {
      const latSum = estados.reduce((a, e) => a + Number(e.latitud), 0);
      const lngSum = estados.reduce((a, e) => a + Number(e.longitud), 0);
      const lat = latSum / estados.length;
      const lng = lngSum / estados.length;
      if (!isNaN(lat) && !isNaN(lng)) return { lat, lng };
    }
    return this.coord.getCoordRegion(nombreRegion);
  }

  // Filtros activos
  getRegionesConDatos(): string[] {
    const capas = this.capasVisibles();
    const regiones = new Set<string>();

    const extraer = (lista: any[]) => lista.forEach(i => {
      const reg = i.estado ? this.obtenerRegion(i.estado) : i.region;
      if (reg) regiones.add(reg);
    });
    const tipos = capas.operaciones ? capas.detalleOperaciones : capas.detalleRegiones;

    if (tipos.length > 0) {
      tipos.forEach((t: TipoElemento) => extraer(this.element.getDataPorTipo(t)));
    }
    return Array.from(regiones);
  }

  getEstadosConDatos(): { nombre: string; color: string }[] {
    const capas = this.capasVisibles();
    const tipos: TipoElemento[] = capas.operaciones ? capas.detalleOperaciones : [...capas.detalleRegiones];

    const nombres = new Set<string>();
    tipos.forEach(t => this.element.getDataPorTipo(t).forEach((i: any) => { if (i.estado) nombres.add(i.estado); }));

    return this.element.estadosSignal()
      .filter(e => nombres.has(e.nombre))
      .map(e => ({ nombre: e.nombre, color: this.getColorEstado(e.nombre) }));
  }

  // Totales
  getTotalesPorEstado(tipo: TipoElemento) { return this.element.getTotalesPorEstado(tipo); }
  getTotalesPorRegion(tipo: TipoElemento) { return this.element.getTotalesPorRegion(tipo); }

  // Control de capas
  toggleCapa(nombre: keyof CapasEstado) {
    this.capasVisibles.update(e => {
      if (nombre === 'cotas' || nombre === 'electricidad' || nombre === 'vias') {
        return { ...e, [nombre]: !e[nombre] };
      }

      const activar = !e[nombre];
      const nuevo = { ...e, [nombre]: activar };
      // División Política (operaciones) se combina con Demografía, pero es excluyente con Zonas Regionales
      if (nombre === 'operaciones' && activar) { nuevo.regiones = false; if (!nuevo.poblacion) nuevo.detalleRegiones = []; }
      if (nombre === 'regiones' && activar) { nuevo.operaciones = false; nuevo.detalleOperaciones = []; }
            if (nombre === 'operaciones' && !activar) nuevo.detalleOperaciones = [];
      // Los totales (detalleRegiones) se comparten entre Regiones y Demografía: solo se limpian si ambas se apagan
      if ((nombre === 'regiones' || nombre === 'poblacion') && !activar && !nuevo.regiones && !nuevo.poblacion) {
        nuevo.detalleRegiones = [];
      }
      return nuevo;
    });
  }

  setDetalleOperaciones(tipo: TipoElemento) {
    this.capasVisibles.update(e => {
      const lista = e.detalleOperaciones.includes(tipo)
        ? e.detalleOperaciones.filter(t => t !== tipo)
        : [...e.detalleOperaciones, tipo];
      return { ...e, detalleOperaciones: lista };
    });
  }

  setDetalleRegiones(tipo: TipoElemento) {
    this.capasVisibles.update(e => {
      const actual = [...e.detalleRegiones];
      const idx = actual.indexOf(tipo);
      const nuevo = idx >= 0 ? actual.filter(t => t !== tipo) : [...actual, tipo];
      return { ...e, detalleRegiones: nuevo };
    });
  }
}
