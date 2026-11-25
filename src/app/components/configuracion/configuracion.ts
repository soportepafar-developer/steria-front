import { Component, OnInit, inject, signal, ChangeDetectionStrategy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import {
  ConfigService,
  ESTADOS_VENEZUELA,
  EsquemaRegional,
  RegionConfigItem,
  SistemaConfig,
} from '../../services/config/configService';
import { ToastService } from '../../services/toast/toastService';
import { GisService } from '../../services/gis/gisService';

@Component({
  selector: 'app-configuracion',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './configuracion.html',
  changeDetection: ChangeDetectionStrategy.Eager,
  styleUrl: './configuracion.css',
})
export class Configuracion implements OnInit {
  private configService = inject(ConfigService);
  private toastService = inject(ToastService);
  private gis = inject(GisService);

  tabActiva = signal<'regiones' | 'elementos'>('regiones');
  modoEdicion = signal(false);
  guardando = signal(false);
  draft: SistemaConfig = this.clone(this.configService.configSignal());
  estadosDisponibles = ESTADOS_VENEZUELA;
  estadoNuevoEsquema = false;
  nombreNuevoEsquema = '';
  regionSeleccionadaId: string | null = null;
  filtroEstado = '';
  elementoIconoAbiertoId: string | null = null;

  iconosDisponibles = [
    { clase: 'fas fa-broadcast-tower', label: 'Antena' },
    { clase: 'fas fa-user-check', label: 'Abonado' },
    { clase: 'fas fa-building', label: 'Oficina' },
    { clase: 'fas fa-store', label: 'Agente' },
    { clase: 'fas fa-truck', label: 'Transporte' },
    { clase: 'fas fa-car', label: 'Vehículo' },
    { clase: 'fas fa-warehouse', label: 'Almacén' },
    { clase: 'fas fa-map-pin', label: 'Pin' },
    { clase: 'fas fa-users', label: 'Equipo' },
    { clase: 'fas fa-wrench', label: 'Taller' },
    { clase: 'fas fa-bolt', label: 'Energía' },
    { clase: 'fas fa-circle', label: 'Punto' },
  ];

  ngOnInit() {
    this.configService.cargarConfiguracion().subscribe({
      next: () => {
        this.draft = this.clone(this.configService.configSignal());
        this.seleccionarEsquema();
      },
    });
  }

  private clone(obj: SistemaConfig): SistemaConfig {
    return JSON.parse(JSON.stringify(obj));
  }

  get configLectura(): SistemaConfig {
    return this.configService.configSignal();
  }

  get esquemaActual(): EsquemaRegional {
    const source = this.modoEdicion() ? this.draft : this.configLectura;
    return source.esquemas.find((e) => e.id === source.esquemaActivoId) || source.esquemas[0];
  }

  get regionSeleccionada(): RegionConfigItem | null {
    const regiones = this.esquemaActual?.regiones || [];
    if (regiones.length === 0) return null;
    return regiones.find((r) => r.id === this.regionSeleccionadaId) || regiones[0];
  }

  activarEdicion() {
    this.draft = this.clone(this.configService.configSignal());
    this.seleccionarEsquema();
    this.modoEdicion.set(true);
  }

  cancelarEdicion() {
    this.draft = this.clone(this.configService.configSignal());
    this.estadoNuevoEsquema = false;
    this.elementoIconoAbiertoId = null;
    this.seleccionarEsquema();
    this.modoEdicion.set(false);
  }

  seleccionarEsquema() {
    this.regionSeleccionadaId = this.esquemaActual?.regiones?.[0]?.id ?? null;
    this.filtroEstado = '';
  }

  seleccionarRegion(regionId: string) {
    this.regionSeleccionadaId = regionId;
  }

  crearEsquema() {
    const nombre = this.nombreNuevoEsquema.trim();
    if (!nombre) return;
    const id = 'esq_' + Date.now();
    const regId = 'reg_' + Date.now();
    this.draft.esquemas.push({
      id,
      nombre,
      regiones: [{ id: regId, nombre: 'Región 1', color: '#3240A5', estados: [] }],
    });
    this.draft.esquemaActivoId = id;
    this.regionSeleccionadaId = regId;
    this.nombreNuevoEsquema = '';
    this.estadoNuevoEsquema = false;
  }

  eliminarEsquema(id: string) {
    if (this.draft.esquemas.length <= 1) return;
    this.draft.esquemas = this.draft.esquemas.filter((e) => e.id !== id);
    if (this.draft.esquemaActivoId === id) {
      this.draft.esquemaActivoId = this.draft.esquemas[0].id;
    }
    this.seleccionarEsquema();
  }

  agregarRegion() {
    const n = this.esquemaActual.regiones.length + 1;
    const newId = 'reg_' + Date.now();
    this.esquemaActual.regiones.push({
      id: newId,
      nombre: `Nueva Región ${n}`,
      color: '#3B82F6',
      estados: [],
    });
    this.regionSeleccionadaId = newId;
  }

  eliminarRegion(regionId: string, event?: Event) {
    event?.stopPropagation();
    if (this.esquemaActual.regiones.length <= 1) return;
    this.esquemaActual.regiones = this.esquemaActual.regiones.filter((r) => r.id !== regionId);
    if (this.regionSeleccionadaId === regionId) {
      this.regionSeleccionadaId = this.esquemaActual.regiones[0]?.id ?? null;
    }
  }

  toggleEstadoEnRegion(regionId: string, estado: string) {
    const target = this.esquemaActual.regiones.find((r) => r.id === regionId);
    if (!target) return;

    if (target.estados.includes(estado)) {
      target.estados = target.estados.filter((e) => e !== estado);
    } else {
      this.esquemaActual.regiones.forEach((r) => {
        if (r.id !== regionId) {
          r.estados = r.estados.filter((e) => e !== estado);
        }
      });
      target.estados = [...target.estados, estado];
    }
  }

  private coincideFiltro(nombre: string): boolean {
    const q = this.filtroEstado.trim().toLowerCase();
    return !q || nombre.toLowerCase().includes(q);
  }

  get estadosEnRegionActual(): string[] {
    if (!this.regionSeleccionada) return [];
    return this.regionSeleccionada.estados.filter((e) => this.coincideFiltro(e));
  }

  get estadosSinAsignar(): string[] {
    const asignados = new Set((this.esquemaActual?.regiones || []).flatMap((r) => r.estados));
    return this.estadosDisponibles.filter((e) => !asignados.has(e));
  }

  get estadosSinAsignarFiltrados(): string[] {
    return this.estadosSinAsignar.filter((e) => this.coincideFiltro(e));
  }

  get estadosEnOtrasRegiones(): { estado: string; region: string; color: string }[] {
    if (!this.regionSeleccionada) return [];
    const actualId = this.regionSeleccionada.id;
    const lista: { estado: string; region: string; color: string }[] = [];
    (this.esquemaActual?.regiones || []).forEach((r) => {
      if (r.id === actualId) return;
      r.estados.forEach((est) => {
        if (this.coincideFiltro(est)) {
          lista.push({ estado: est, region: r.nombre, color: r.color });
        }
      });
    });
    return lista.sort((a, b) => a.estado.localeCompare(b.estado));
  }

  toggleSelectorIcono(id: string) {
    this.elementoIconoAbiertoId = this.elementoIconoAbiertoId === id ? null : id;
  }

  seleccionarIcono(el: any, claseIcono: string) {
    el.icono = claseIcono;
    this.elementoIconoAbiertoId = null;
  }

  guardar() {
    if (this.guardando()) return;
    this.guardando.set(true);
    this.configService.guardarConfiguracion(this.draft).subscribe({
      next: (res) => {
        this.draft = this.clone(this.configService.configSignal());
        this.gis.cargarDatos();
        this.guardando.set(false);
        this.modoEdicion.set(false);
        this.elementoIconoAbiertoId = null;
        this.toastService.showSuccess(res?.message || 'Configuración guardada y aplicada.');
      },
      error: (err) => {
        console.error('Error guardando configuración:', err);
        this.guardando.set(false);
        this.toastService.showError('No se pudo guardar la configuración. Verifique sus permisos.');
      },
    });
  }

  restaurar() {
    if (this.guardando()) return;
    this.guardando.set(true);
    this.configService.restaurarPredeterminados().subscribe({
      next: (res) => {
        this.draft = this.clone(this.configService.configSignal());
        this.seleccionarEsquema();
        this.gis.cargarDatos();
        this.guardando.set(false);
        this.modoEdicion.set(false);
        this.elementoIconoAbiertoId = null;
        this.toastService.showInfo(
          res?.message || 'Configuración restaurada a los valores predeterminados.',
        );
      },
      error: (err) => {
        console.error('Error restaurando configuración:', err);
        this.guardando.set(false);
        this.toastService.showError('No se pudo restaurar la configuración.');
      },
    });
  }
}
