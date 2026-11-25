import { Component, inject, signal, ChangeDetectionStrategy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { NgSelectModule } from '@ng-select/ng-select';
import { GisService } from '../../services/gis/gisService';
import { ProyectoService } from '../../services/proyecto/proyectoService';
import { Proyecto, ProyectoFigura } from '../../models/gis';
import { ToastService } from '../../services/toast/toastService';
import { KmlService } from '../../services/proyecto/kmlService';

@Component({
  selector: 'app-project-manager',
  standalone: true,
  imports: [CommonModule, FormsModule, NgSelectModule],
  templateUrl: './project-manager.html',
  changeDetection: ChangeDetectionStrategy.Eager,
  styleUrl: './project-manager.css',
})
export class ProjectManager {
  public gis = inject(GisService);
  public proyectoService = inject(ProyectoService);
  private toastService = inject(ToastService);
  private kmlService = inject(KmlService);

  mostrarCrearProyecto = signal(false);
  mostrarMenuExportar = signal(false); // Signal para menú de exportación
  mostrarImportar = signal(false); // Signal para mostrar panel de importación
  dragActivo = signal(false); // Estado drag over
  mostrarModalConfirmacion = signal(false); // Modal confirmación
  archivoImportado = signal<any>(null); // Datos del archivo parseado

  nombreNuevoProyecto = '';
  descripcionNuevoProyecto = '';

  // Variables para la asignación dinámica de proyectos al importar
  mostrarSubPanelGuardar = signal(false);
  opcionAsignacion = 'existente';
  proyectoSeleccionadoId: number | null | undefined = null;
  nombreProyectoNuevoImportacion = '';
  filtroProyectosImportacion = '';

  get proyectosFiltrados() {
    const query = this.filtroProyectosImportacion.toLowerCase().trim();
    const proyectos = this.proyectoService.proyectos() || [];
    if (!query) return proyectos;
    return proyectos.filter(
      (p) =>
        (p.nombre && p.nombre.toLowerCase().includes(query)) ||
        (p.descripcion && p.descripcion.toLowerCase().includes(query)),
    );
  }

  // Modal genérico para confirmaciones de borrado
  confirmacionModal = {
    abierto: false,
    titulo: '',
    mensaje: '',
    accion: () => {},
  };

  cancelarConfirmacion() {
    this.confirmacionModal.abierto = false;
  }

  ejecutarConfirmacion() {
    this.confirmacionModal.abierto = false;
    this.confirmacionModal.accion();
  }

  // Permite colapsar el panel flotante en la derecha
  colapsado = signal(false);
  cargandoProyectos = signal(true);

  get leyendaVisible(): boolean {
    const capas = this.gis.capasVisibles();
    return (
      (capas.operaciones && this.gis.getEstadosConDatos().length > 0) ||
      (capas.regiones && !capas.operaciones) ||
      capas.poblacion
    );
  }

  constructor() {
    setTimeout(() => {
      this.proyectoService.cargarProyectos();
      this.cargandoProyectos.set(false);
    }, 850);
  }

  crearNuevoProyecto() {
    if (!this.nombreNuevoProyecto.trim()) return;
    this.proyectoService
      .crearProyecto(this.nombreNuevoProyecto, this.descripcionNuevoProyecto)
      .subscribe({
        next: () => {
          this.proyectoService.cargarProyectos();
          this.nombreNuevoProyecto = '';
          this.descripcionNuevoProyecto = '';
          this.mostrarCrearProyecto.set(false);
        },
        error: (err) => console.error('Error al crear proyecto:', err),
      });
  }

  eliminarProyecto(id: number, event: Event) {
    event.stopPropagation();
    this.confirmacionModal = {
      abierto: true,
      titulo: '¿Eliminar Proyecto?',
      mensaje:
        '¿Estás seguro de eliminar este proyecto y todos sus polígonos/rutas guardados? Esta acción es permanente y no se puede revertir.',
      accion: () => {
        this.proyectoService.eliminarProyecto(id).subscribe({
          next: () => {
            this.proyectoService.cargarProyectos();
            if (this.proyectoService.proyectoActivo()?.id === id) {
              this.proyectoService.seleccionarProyecto(null);
            }
            this.toastService.showSuccess('Proyecto eliminado correctamente.');
          },
          error: (err) => console.error('Error al eliminar proyecto:', err),
        });
      },
    };
  }

  seleccionarProyecto(event: any) {
    const id = event?.target?.value ? Number(event.target.value) : null;
    if (id) {
      const proj = this.proyectoService.proyectos().find((p: Proyecto) => p.id === id) || null;
      this.proyectoService.seleccionarProyecto(proj);
    } else {
      this.proyectoService.seleccionarProyecto(null);
    }
  }

  seleccionarProyectoNg(selection: any) {
    if (selection) {
      const id = typeof selection === 'object' ? selection.id : Number(selection);
      const proj = this.proyectoService.proyectos().find((p: Proyecto) => p.id === id) || null;
      this.proyectoService.seleccionarProyecto(proj);
    } else {
      this.proyectoService.seleccionarProyecto(null);
    }
  }

  eliminarFigura(id: number, event: Event) {
    event.stopPropagation();
    if (id < 0) {
      this.confirmacionModal = {
        abierto: true,
        titulo: '¿Eliminar Elemento Temporal?',
        mensaje:
          '¿Estás seguro de eliminar esta figura importada temporal? Se removerá del mapa y la barra lateral.',
        accion: () => {
          this.proyectoService.figurasProyectoActivo.update((figuras) =>
            figuras.filter((f) => f.id !== id),
          );
          this.toastService.showSuccess('Elemento temporal removido.');
        },
      };
      return;
    }

    this.confirmacionModal = {
      abierto: true,
      titulo: '¿Eliminar Figura?',
      mensaje: '¿Estás seguro de eliminar esta figura guardada? Esta acción no se puede deshacer.',
      accion: () => {
        this.proyectoService.eliminarFigura(id).subscribe({
          next: () => {
            const activeProj = this.proyectoService.proyectoActivo();
            if (activeProj?.id) {
              this.proyectoService.cargarFigurasProyecto(activeProj.id);
            }
            this.toastService.showSuccess('Figura eliminada del proyecto.');
          },
          error: (err) => console.error('Error al eliminar figura:', err),
        });
      },
    };
  }

  toggleVisibilidadFigura(figura: any, event: Event) {
    event.stopPropagation();
    if (figura.id) {
      this.proyectoService.toggleVisibilidadFigura(figura.id);
    }
  }

  centrarFigura(figura: any) {
    this.gis.figuraEnfocada.set(figura);
  }

  toggleMenuExportar(event: Event) {
    event.stopPropagation();
    this.mostrarMenuExportar.set(!this.mostrarMenuExportar());
  }

  exportarGeoJson(event: Event) {
    event.stopPropagation();
    this.mostrarMenuExportar.set(false);
    const activo = this.proyectoService.proyectoActivo();
    if (!activo) return;
    this.kmlService.exportarGeoJson(activo.nombre, this.proyectoService.figurasProyectoActivo());
  }

  exportarKml(event: Event) {
    event.stopPropagation();
    this.mostrarMenuExportar.set(false);
    const activo = this.proyectoService.proyectoActivo();
    if (!activo) return;
    this.kmlService.exportarKml(activo.nombre, this.proyectoService.figurasProyectoActivo());
  }

  // --- MÉTODOS DE IMPORTACIÓN DE ARCHIVOS (UX HÍBRIDO) ---

  toggleImportar() {
    this.mostrarImportar.set(!this.mostrarImportar());
  }

  onDragOver(event: DragEvent) {
    event.preventDefault();
    event.stopPropagation();
    this.dragActivo.set(true);
  }

  onDragLeave(event: DragEvent) {
    event.preventDefault();
    event.stopPropagation();
    this.dragActivo.set(false);
  }

  onDrop(event: DragEvent) {
    event.preventDefault();
    event.stopPropagation();
    this.dragActivo.set(false);

    if (event.dataTransfer && event.dataTransfer.files.length > 0) {
      const file = event.dataTransfer.files[0];
      this.procesarArchivo(file);
    }
  }

  onFileSelected(event: any) {
    const input = event.target as HTMLInputElement;
    if (input.files && input.files.length > 0) {
      const file = input.files[0];
      this.procesarArchivo(file);
      // Limpiar input para permitir cargar el mismo archivo consecutivamente
      input.value = '';
    }
  }

  private procesarArchivo(file: File) {
    const extension = file.name.substring(file.name.lastIndexOf('.')).toLowerCase();
    if (extension !== '.geojson' && extension !== '.kml' && extension !== '.json') {
      this.toastService.showError('Formato no soportado. Suba archivos .geojson o .kml.');
      return;
    }

    const reader = new FileReader();
    reader.onload = (e: any) => {
      try {
        const parsed = this.kmlService.parsearArchivoEspacial(file.name, e.target.result);
        this.archivoImportado.set(parsed);

        const activo = this.proyectoService.proyectoActivo();
        if (activo && activo.id) {
          this.proyectoSeleccionadoId = activo.id;
          this.mostrarSubPanelGuardar.set(false);
        } else {
          this.proyectoSeleccionadoId = null;
          this.mostrarSubPanelGuardar.set(true);
        }
        this.opcionAsignacion = 'existente';
        this.filtroProyectosImportacion = '';

        this.gis.importacionPreliminarActiva.set(true);
        this.mostrarModalConfirmacion.set(true);
        this.mostrarImportar.set(false);
      } catch (err: any) {
        console.error('Error parseando el archivo:', err);
        this.toastService.showError(
          err?.message || 'Error al leer el archivo. Compruebe que esté bien formateado.',
        );
      }
    };

    reader.readAsText(file);
  }

  importarSoloVisualizar() {
    const datos = this.archivoImportado();
    if (!datos) return;

    const figInstancias: ProyectoFigura[] = datos.features.map((feat: any, idx: number) => {
      const prop = feat.properties || {};
      const geom = feat.geometry || {};
      const tipo = prop.tipo || 'poligono';

      let coordenadas: any;
      if (tipo === 'poligono') {
        coordenadas = geom.coordinates[0].map((pt: any) => ({ lat: pt[1], lng: pt[0] }));
      } else if (tipo === 'ruta') {
        coordenadas = geom.coordinates.map((pt: any) => ({ lat: pt[1], lng: pt[0] }));
      } else if (tipo === 'circulo' && prop.radio) {
        const ring = geom.coordinates[0];
        let latSum = 0;
        let lngSum = 0;
        const numPoints = ring.length - 1;
        for (let i = 0; i < numPoints; i++) {
          lngSum += ring[i][0];
          latSum += ring[i][1];
        }
        coordenadas = { lat: latSum / numPoints, lng: lngSum / numPoints };
      } else {
        coordenadas = [];
      }

      return {
        id: -(idx + 1), // ID temporal
        nombre: prop.nombre || `Temporal #${idx + 1}`,
        tipo: tipo,
        coordenadas: JSON.stringify(coordenadas),
        color: prop.color || '#4f46e5',
        radio: prop.radio || null,
        visible: true,
      };
    });

    // Cargar en el servicio del proyecto (remplazando o agregando)
    this.proyectoService.figurasProyectoActivo.set(figInstancias);
    this.toastService.showSuccess(`Cargados ${figInstancias.length} elementos de forma temporal.`);

    // Ajustar límites del mapa
    this.centrarCamaraEnCoordenadas(datos.features);
    this.gis.importacionPreliminarActiva.set(false);
    this.mostrarModalConfirmacion.set(false);
  }

  cancelarImportacion() {
    this.mostrarModalConfirmacion.set(false);
    this.mostrarSubPanelGuardar.set(false);
    this.gis.importacionPreliminarActiva.set(false);
    this.archivoImportado.set(null);
    this.filtroProyectosImportacion = '';
    this.proyectoSeleccionadoId = null;
    this.nombreProyectoNuevoImportacion = '';
  }

  importarGuardarProyecto() {
    const datos = this.archivoImportado();
    if (!datos) return;

    // Si no está abierto el subpanel
    if (!this.mostrarSubPanelGuardar()) {
      if (this.proyectoSeleccionadoId) {
        const proj = this.proyectoService
          .proyectos()
          .find((p) => p.id === this.proyectoSeleccionadoId);
        if (proj && proj.id) {
          this.proyectoService.seleccionarProyecto(proj);
          this.ejecutarGuardadoFiguras(proj.id, proj.nombre, datos.features);
          return;
        }
      }
      this.mostrarSubPanelGuardar.set(true);
      return;
    }

    // Caso 1: Destino en proyecto existente
    if (this.opcionAsignacion === 'existente') {
      if (!this.proyectoSeleccionadoId) {
        this.toastService.showError('Seleccione un proyecto de destino.');
        return;
      }
      const proj = this.proyectoService
        .proyectos()
        .find((p) => p.id === this.proyectoSeleccionadoId);
      if (proj && proj.id) {
        this.proyectoService.seleccionarProyecto(proj);
        this.ejecutarGuardadoFiguras(proj.id, proj.nombre, datos.features);
      }
      return;
    }

    // Caso 2: Destino en proyecto nuevo
    if (this.opcionAsignacion === 'nuevo') {
      if (!this.nombreProyectoNuevoImportacion.trim()) {
        this.toastService.showError('Escriba el nombre del nuevo proyecto.');
        return;
      }

      this.proyectoService
        .crearProyecto(this.nombreProyectoNuevoImportacion, 'Proyecto creado al importar figuras')
        .subscribe({
          next: (res) => {
            this.proyectoService.cargarProyectos();
            const nuevoProjId = res.id;
            const nuevoProjNombre = res.nombre || this.nombreProyectoNuevoImportacion;

            if (nuevoProjId) {
              const nuevoProj = {
                id: nuevoProjId,
                nombre: nuevoProjNombre,
                descripcion: 'Proyecto creado al importar figuras',
              };
              this.proyectoService.seleccionarProyecto(nuevoProj);
              this.ejecutarGuardadoFiguras(nuevoProjId, nuevoProjNombre, datos.features);
            } else {
              setTimeout(() => {
                const proj = this.proyectoService
                  .proyectos()
                  .find((p) => p.nombre === this.nombreProyectoNuevoImportacion);
                if (proj && proj.id) {
                  this.proyectoService.seleccionarProyecto(proj);
                  this.ejecutarGuardadoFiguras(proj.id, proj.nombre, datos.features);
                } else {
                  this.toastService.showError('Error al crear el proyecto de destino.');
                }
              }, 500);
            }
          },
          error: (err) => {
            console.error('Error al crear proyecto en importación:', err);
            this.toastService.showError('Fallo al crear el proyecto.');
          },
        });
    }
  }

  private ejecutarGuardadoFiguras(proyectoId: number, proyectoNombre: string, features: any[]) {
    let guardadosCount = 0;

    const guardarSecuencial = (index: number) => {
      if (index >= features.length) {
        this.toastService.showSuccess(
          `Guardadas ${guardadosCount} figuras en el proyecto '${proyectoNombre}'.`,
        );
        this.proyectoService.cargarFigurasProyecto(proyectoId);
        this.centrarCamaraEnCoordenadas(features);
        this.gis.importacionPreliminarActiva.set(false);
        this.mostrarModalConfirmacion.set(false);
        this.mostrarSubPanelGuardar.set(false);
        this.nombreProyectoNuevoImportacion = '';
        this.proyectoSeleccionadoId = null;
        this.filtroProyectosImportacion = '';
        return;
      }

      const feat = features[index];
      const prop = feat.properties || {};
      const geom = feat.geometry || {};
      const tipo = prop.tipo || 'poligono';

      let coordenadas: any;
      if (tipo === 'poligono') {
        coordenadas = geom.coordinates[0].map((pt: any) => ({ lat: pt[1], lng: pt[0] }));
      } else if (tipo === 'ruta') {
        coordenadas = geom.coordinates.map((pt: any) => ({ lat: pt[1], lng: pt[0] }));
      } else if (tipo === 'circulo' && prop.radio) {
        const ring = geom.coordinates[0];
        let latSum = 0;
        let lngSum = 0;
        const numPoints = ring.length - 1;
        for (let i = 0; i < numPoints; i++) {
          lngSum += ring[i][0];
          latSum += ring[i][1];
        }
        coordenadas = { lat: latSum / numPoints, lng: lngSum / numPoints };
      } else {
        coordenadas = [];
      }

      const figuraAGuardar = {
        nombre: prop.nombre || `Elemento #${index + 1}`,
        tipo: tipo,
        coordenadas: JSON.stringify(coordenadas),
        color: prop.color || '#4f46e5',
        radio: prop.radio || null,
        visible: true,
      };

      this.proyectoService.guardarFigura(proyectoId, figuraAGuardar).subscribe({
        next: () => {
          guardadosCount++;
          guardarSecuencial(index + 1);
        },
        error: (err) => {
          console.error(`Error guardando figura #${index + 1}:`, err);
          guardarSecuencial(index + 1);
        },
      });
    };

    guardarSecuencial(0);
  }

  private centrarCamaraEnCoordenadas(features: any[]) {
    if (features.length === 0) return;

    let lats: number[] = [];
    let lngs: number[] = [];

    features.forEach((feat: any) => {
      const geom = feat.geometry;
      if (!geom) return;

      if (geom.type === 'Polygon') {
        geom.coordinates[0].forEach((pt: any) => {
          lngs.push(pt[0]);
          lats.push(pt[1]);
        });
      } else if (geom.type === 'LineString') {
        geom.coordinates.forEach((pt: any) => {
          lngs.push(pt[0]);
          lats.push(pt[1]);
        });
      } else if (geom.type === 'Point') {
        lngs.push(geom.coordinates[0]);
        lats.push(geom.coordinates[1]);
      }
    });

    if (lats.length > 0 && lngs.length > 0) {
      const minLat = Math.min(...lats);
      const maxLat = Math.max(...lats);
      const minLng = Math.min(...lngs);
      const maxLng = Math.max(...lngs);

      // Mandar límites del bounding box al servicio
      this.gis.cajaMapaAjustar.set([
        [minLat, minLng],
        [maxLat, maxLng],
      ]);
    }
  }
}
