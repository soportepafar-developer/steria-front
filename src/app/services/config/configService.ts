import { Injectable, computed, inject, signal } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable, of } from 'rxjs';
import { catchError, map, tap } from 'rxjs/operators';
import { environment } from '../../../environments/environment';
import { TipoElemento } from '../../models/gis';

export interface RegionConfigItem {
  id: string;
  nombre: string;
  color: string;
  estados: string[];
}

export interface EsquemaRegional {
  id: string;
  nombre: string;
  regiones: RegionConfigItem[];
}

export interface ElementoConfig {
  id: Exclude<TipoElemento, 'ninguno'>;
  nombre: string;
  icono: string;
  color: string;
  visible: boolean;
}

export interface ParametrosMapaConfig {
  zoomParroquias: number;
  zoomPines: number;
  zoomSatelite: number;
  capaInicial: 'ninguna' | 'regiones' | 'poblacion' | 'operaciones';
}

export interface SistemaConfig {
  esquemaActivoId: string;
  esquemas: EsquemaRegional[];
  elementos: ElementoConfig[];
  mapa: ParametrosMapaConfig;
}

export interface BackendConfigPayload {
  esquemaActivoId: string;
  esquemas: EsquemaRegional[];
  elementos: ElementoConfig[];
}

const STORAGE_KEY = 'steria_system_config_v1';

export const ESTADOS_VENEZUELA: string[] = [
  'Amazonas',
  'Anzoátegui',
  'Apure',
  'Aragua',
  'Barinas',
  'Bolívar',
  'Carabobo',
  'Cojedes',
  'Delta Amacuro',
  'Dependencias Federales',
  'Distrito Capital',
  'Falcón',
  'Guárico',
  'La Guaira',
  'Lara',
  'Mérida',
  'Miranda',
  'Monagas',
  'Nueva Esparta',
  'Portuguesa',
  'Sucre',
  'Táchira',
  'Trujillo',
  'Yaracuy',
  'Zulia',
];

const DEFAULT_MAPA_PARAMS: ParametrosMapaConfig = {
  zoomParroquias: 8.5,
  zoomPines: 11.5,
  zoomSatelite: 14,
  capaInicial: 'ninguna',
};

function buildDefaultConfig(): SistemaConfig {
  return {
    esquemaActivoId: 'estandar',
    esquemas: [
      {
        id: 'estandar',
        nombre: 'Estándar (9 Regiones)',
        regiones: [
          { id: 'capital', nombre: 'Capital', color: '#8B5CF6', estados: ['Distrito Capital', 'Miranda', 'La Guaira'] },
          { id: 'central', nombre: 'Central', color: '#EF4444', estados: ['Carabobo', 'Aragua', 'Cojedes'] },
          { id: 'llanos', nombre: 'Los Llanos', color: '#F59E0B', estados: ['Guárico', 'Apure'] },
          { id: 'centro_occ', nombre: 'Centro Occidental', color: '#10B981', estados: ['Falcón', 'Lara', 'Portuguesa', 'Yaracuy'] },
          { id: 'zuliana', nombre: 'Zuliana', color: '#3B82F6', estados: ['Zulia'] },
          { id: 'andes', nombre: 'Los Andes', color: '#6366F1', estados: ['Mérida', 'Táchira', 'Trujillo', 'Barinas'] },
          { id: 'nororiental', nombre: 'Nororiental', color: '#EC4899', estados: ['Anzoátegui', 'Monagas', 'Sucre'] },
          { id: 'insular', nombre: 'Insular', color: '#06B6D4', estados: ['Nueva Esparta', 'Dependencias Federales'] },
          { id: 'guayana', nombre: 'Guayana', color: '#14B8A6', estados: ['Bolívar', 'Amazonas', 'Delta Amacuro'] },
        ],
      },
      {
        id: 'operaciones_7',
        nombre: 'Operaciones / Transporte (7 Regiones)',
        regiones: [
          { id: 'cap7', nombre: 'Capital', color: '#EF4444', estados: ['Distrito Capital', 'Miranda', 'La Guaira'] },
          { id: 'cen7', nombre: 'Central', color: '#F59E0B', estados: ['Aragua', 'Carabobo', 'Guárico', 'Apure', 'Amazonas'] },
          { id: 'coc7', nombre: 'Centro-Occidente', color: '#EC4899', estados: ['Lara', 'Yaracuy', 'Portuguesa', 'Cojedes'] },
          { id: 'occ7', nombre: 'Occidente', color: '#3B82F6', estados: ['Zulia', 'Trujillo', 'Falcón'] },
          { id: 'and7', nombre: 'Andes', color: '#8B5CF6', estados: ['Táchira', 'Barinas', 'Mérida'] },
          { id: 'ori7', nombre: 'Oriente', color: '#10B981', estados: ['Anzoátegui', 'Sucre', 'Nueva Esparta'] },
          { id: 'gua7', nombre: 'Guayana', color: '#22C55E', estados: ['Bolívar', 'Monagas'] },
        ],
      },
    ],
    elementos: [
      { id: 'antenas', nombre: 'Radio Bases', icono: 'fas fa-broadcast-tower', color: '#FF1493', visible: true },
      { id: 'abonados', nombre: 'Abonados', icono: 'fas fa-user-check', color: '#00BFFF', visible: true },
      { id: 'oficinas', nombre: 'Oficinas', icono: 'fas fa-building', color: '#32CD32', visible: true },
      { id: 'agentes', nombre: 'Agentes', icono: 'fas fa-store', color: '#FF8C00', visible: true },
    ],
    mapa: { ...DEFAULT_MAPA_PARAMS },
  };
}

@Injectable({ providedIn: 'root' })
export class ConfigService {
  private http = inject(HttpClient);
  private API_URL = `${environment.apiUrl}/config`;

  configSignal = signal<SistemaConfig>(this.loadInitialConfig());

  esquemaActivo = computed<EsquemaRegional>(() => {
    const cfg = this.configSignal();
    return cfg.esquemas.find((e) => e.id === cfg.esquemaActivoId) || cfg.esquemas[0];
  });

  elementosVisibles = computed<ElementoConfig[]>(() =>
    this.configSignal().elementos.filter((el) => el.visible),
  );

  constructor() {
    if (typeof localStorage !== 'undefined' && localStorage.getItem('token_geo')) {
      this.cargarConfiguracion().subscribe();
    }
  }

  private loadInitialConfig(): SistemaConfig {
    if (typeof localStorage === 'undefined') return buildDefaultConfig();
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return buildDefaultConfig();
      const parsed = JSON.parse(raw) as Partial<SistemaConfig>;
      if (!parsed.esquemas?.length || !parsed.elementos?.length) {
        return buildDefaultConfig();
      }
      return {
        esquemaActivoId: parsed.esquemaActivoId || parsed.esquemas[0].id,
        esquemas: parsed.esquemas,
        elementos: parsed.elementos,
        mapa: { ...DEFAULT_MAPA_PARAMS, ...(parsed.mapa || {}) },
      };
    } catch {
      return buildDefaultConfig();
    }
  }

  private persistLocal(cfg: SistemaConfig) {
    const cloned = JSON.parse(JSON.stringify(cfg)) as SistemaConfig;
    this.configSignal.set(cloned);
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(cloned));
    }
  }

  private mergeBackendConfig(backendCfg: Partial<BackendConfigPayload>, mapaLocal?: ParametrosMapaConfig): SistemaConfig {
    const fallback = buildDefaultConfig();
    const currentMapa = mapaLocal || this.configSignal().mapa || DEFAULT_MAPA_PARAMS;
    const esquemas = backendCfg?.esquemas?.length ? backendCfg.esquemas : fallback.esquemas;
    const elementos = backendCfg?.elementos?.length ? backendCfg.elementos : fallback.elementos;
    const esquemaActivoId =
      backendCfg?.esquemaActivoId && esquemas.some((e) => e.id === backendCfg.esquemaActivoId)
        ? backendCfg.esquemaActivoId
        : esquemas[0].id;
    return {
      esquemaActivoId,
      esquemas,
      elementos,
      mapa: { ...DEFAULT_MAPA_PARAMS, ...currentMapa },
    };
  }

  /** GET /api/config — Carga la configuración desde el backend y actualiza el cache local */
  cargarConfiguracion(): Observable<SistemaConfig> {
    if (typeof localStorage === 'undefined' || !localStorage.getItem('token_geo')) {
      return of(this.configSignal());
    }
    return this.http.get<BackendConfigPayload>(this.API_URL).pipe(
      map((res) => {
        if (res && res.esquemas?.length && res.elementos?.length) {
          const merged = this.mergeBackendConfig(res);
          this.persistLocal(merged);
          return merged;
        }
        return this.configSignal();
      }),
      catchError((err) => {
        console.error('Error cargando configuración desde /api/config:', err);
        return of(this.configSignal());
      }),
    );
  }

  /** PUT /api/config — Guarda esquemaActivoId, esquemas y elementos en backend (y mapa en localStorage) */
  guardarConfiguracion(nueva: SistemaConfig): Observable<{ status: string; message: string; config: BackendConfigPayload }> {
    const payload: BackendConfigPayload = {
      esquemaActivoId: nueva.esquemaActivoId,
      esquemas: nueva.esquemas,
      elementos: nueva.elementos,
    };
    return this.http.put<{ status: string; message: string; config: BackendConfigPayload }>(this.API_URL, payload).pipe(
      tap((res) => {
        const merged = res?.config
          ? this.mergeBackendConfig(res.config, nueva.mapa)
          : nueva;
        this.persistLocal(merged);
      }),
    );
  }

  /** POST /api/config/restaurar — Restaura la configuración predeterminada en backend */
  restaurarPredeterminados(): Observable<{ status: string; message: string; config: BackendConfigPayload }> {
    return this.http
      .post<{ status: string; message: string; config: BackendConfigPayload }>(`${this.API_URL}/restaurar`, {})
      .pipe(
        tap((res) => {
          const merged = res?.config?.esquemas?.length
            ? this.mergeBackendConfig(res.config, { ...DEFAULT_MAPA_PARAMS })
            : buildDefaultConfig();
          this.persistLocal(merged);
        }),
      );
  }

  isElementoVisible(id: Exclude<TipoElemento, 'ninguno'>): boolean {
    const found = this.configSignal().elementos.find((e) => e.id === id);
    return found ? found.visible : true;
  }

  getElementoConfig(id: Exclude<TipoElemento, 'ninguno'>): ElementoConfig | undefined {
    return this.configSignal().elementos.find((e) => e.id === id);
  }

  getRegionDeEstado(nombreEstado: string): string | null {
    const esquema = this.esquemaActivo();
    const region = esquema.regiones.find((r) => r.estados.includes(nombreEstado));
    return region ? region.nombre : null;
  }

  getColorRegion(nombreRegion: string): string | null {
    const esquema = this.esquemaActivo();
    const region = esquema.regiones.find((r) => r.nombre === nombreRegion);
    return region ? region.color : null;
  }
}
