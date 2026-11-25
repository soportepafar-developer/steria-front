import {
  Component,
  AfterViewInit,
  inject,
  ElementRef,
  ViewChild,
  effect,
  signal,
  ChangeDetectionStrategy,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { HttpClient } from '@angular/common/http';
import { GisService as Gis } from '../../services/gis/gisService';
import { TipoElemento, ProyectoFigura } from '../../models/gis';
import * as L from 'leaflet';
import { ProyectoService } from '../../services/proyecto/proyectoService';
import { Totales } from '../totales/totales';
import { ElementRendererService } from '../../services/element/elementRendererService';
import { ElementService } from '../../services/element/elementService';
import { GisMathService } from '../../services/gis/gisMathService';
import { ConfigService } from '../../services/config/configService';
import { MapAnalysisService } from '../../services/map/mapAnalysisService';
import { MapMarkerService } from '../../services/map/mapMarkerService';
import { Polygons } from '../polygons/polygons';
import { ProjectManager } from '../project-manager/project-manager';
import '@geoman-io/leaflet-geoman-free';

@Component({
  selector: 'app-map',
  standalone: true,
  imports: [CommonModule, Totales, Polygons, ProjectManager],
  templateUrl: './map.html',
  changeDetection: ChangeDetectionStrategy.Eager,
  styleUrl: './map.css',
})
export class Map implements AfterViewInit {
  public gis = inject(Gis);
  private http = inject(HttpClient);
  private renderer = inject(ElementRendererService);
  private mathService = inject(GisMathService);
  private elementService = inject(ElementService);
  public proyectoService = inject(ProyectoService);
  public configService = inject(ConfigService);
  private analysisService = inject(MapAnalysisService);
  private markerService = inject(MapMarkerService);

  public leyendaAbierta = signal(true);
  public analisisFigura = signal<any | null>(null);
  private activeDrawnLayer: L.Layer | null = null;
  private projectShapesLayer = L.layerGroup();
  private pmEditDebounceTimer: any = null;

  public hoverInfo = signal<{
    nombre: string;
    sub: string;
    x: number;
    y: number;
    regionColor?: string;
    poblacion?: string;
  } | null>(null);

  mostrarHoverInfo(
    nombre: string,
    sub: string,
    containerPoint: L.Point,
    extra?: { regionColor?: string; poblacion?: number },
  ) {
    this.hoverInfo.set({
      nombre,
      sub,
      x: containerPoint.x + 15,
      y: containerPoint.y + 15,
      regionColor: extra?.regionColor,
      poblacion:
        extra?.poblacion !== undefined ? Math.round(extra.poblacion).toLocaleString('es-VE') : undefined,
    });
  }

  /* Leyenda unificada */
  get modoCombinado(): boolean {
    const c = this.gis.capasVisibles();
    return c.poblacion && c.regiones && !c.operaciones;
  }

  get hayLeyenda(): boolean {
    const c = this.gis.capasVisibles();
    return (
      (c.operaciones && !c.poblacion && this.gis.getEstadosConDatos().length > 0) ||
      (c.regiones && !c.operaciones) ||
      c.poblacion
    );
  }

  get tituloLeyenda(): string {
    const c = this.gis.capasVisibles();
    if (c.poblacion && (c.regiones || c.operaciones)) return 'Leyenda';
    if (c.poblacion) return 'Demografía';
    if (c.regiones) return 'Zonas Regionales';
    return 'Estados Activos';
  }

  get nivelVista(): string {
    const zoom = this.gis.zoomLevel();
    if (zoom >= 11.5 && this.gis.capasVisibles().operaciones) return 'Vista: Elementos';
    return zoom >= 8.5 ? 'Vista: Parroquias' : 'Vista: Estados';
  }

  ocultarHoverInfo() {
    this.hoverInfo.set(null);
  }

  private capaGeoJsonRegiones: L.GeoJSON | null = null;
  private capaGeoJsonParroquias: L.GeoJSON | null = null;
  private geoJsonData: any = null;
  private parroquiasGeoJsonData: any = null;
  private parroquiaCentros: Record<string, L.LatLng> = {};
  private areaPorEstado: Record<string, number> = {};
  @ViewChild('mapContainer') mapContainer!: ElementRef;

  private map!: L.Map;
  private poblacionData: Record<string, number> = {};
  
  // Guardamos los elementos ya filtrados por el backend para todo el proyecto activo
  public proyectoElementosFiltrados = signal<{radioBases: any[], oficinas: any[], agentes: any[]} | null>(null);

  private radioBases = L.layerGroup();
  private abonados = L.layerGroup();
  private oficinas = L.layerGroup();
  private agentes = L.layerGroup();
  private layerAggregated = L.layerGroup();
  private capaCotas = L.tileLayer(
    'https://server.arcgisonline.com/ArcGIS/rest/services/World_Topo_Map/MapServer/tile/{z}/{y}/{x}',
    {
      zIndex: 100,
      opacity: 0.6,
    },
  );
  private capaElectricidad = L.layerGroup();
  private datosElectricidadCargados = false;
  private capaElectricidadGeoJson: L.GeoJSON | null = null;
  private capaBordeVenezuela: L.LayerGroup | null = null;
  private viasActivoAnterior = false;

  // Capa Satelital para vista real en zoom cercano
  private capaSatelite = L.tileLayer(
    'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
    {
      zIndex: 405,
    },
  );

  // Tiles base: Google Maps Estándar
  private tileBase = L.tileLayer(
    'http://{s}.google.com/vt/lyrs=m&x={x}&y={y}&z={z}',
    {
      maxZoom: 20,
      subdomains: ['mt0', 'mt1', 'mt2', 'mt3'],
      zIndex: 1,
    },
  );

  constructor() {
    // Escuchar figuras del proyecto activo para renderizarlas (sólo si el módulo está activo y no hay previsualización activa)
    effect(() => {
      const figuras = this.proyectoService.figurasProyectoActivo();
      const activo = this.gis.moduloPoligonosActivo();
      const importacionActiva = this.gis.importacionPreliminarActiva();

      if (activo && !importacionActiva) {
        this.actualizarFigurasProyectoEnMapa(figuras);
        
        // Convertir figuras del proyecto a WKT y consultar al backend
        const wkt = this.mathService.figurasToWKT(figuras.map(f => {
          let coords = f.coordenadas;
          try { coords = typeof f.coordenadas === 'string' ? JSON.parse(f.coordenadas) : f.coordenadas; } catch(e){}
          // Se crea un L.polygon temporal solo para extraer los vértices de manera consistente
          return { tipo: f.tipo, layer: L.polygon(coords) };
        }));
        
        if (wkt) {
          this.elementService.filtrarPorPoligonos(wkt).subscribe((elementos: any[]) => {
            this.proyectoElementosFiltrados.set({
              radioBases: elementos.filter((e: any) => e.tipo === 'antenas'),
              oficinas: elementos.filter((e: any) => e.tipo === 'oficinas'),
              agentes: elementos.filter((e: any) => e.tipo === 'agentes')
            });
          });
        } else {
          this.proyectoElementosFiltrados.set(null);
        }
      } else {
        this.projectShapesLayer.clearLayers();
        this.proyectoElementosFiltrados.set(null);
      }
    });

    // Escuchar figura enfocada para centrar la cámara del mapa
    effect(() => {
      const figura = this.gis.figuraEnfocada();
      if (figura) {
        this.centrarCamaraEnFigura(figura);
        setTimeout(() => this.gis.figuraEnfocada.set(null), 100);
      }
    });

    // Escuchar caja de mapa para ajustar límites (fitBounds)
    effect(() => {
      const bounds = this.gis.cajaMapaAjustar();
      if (bounds && this.map) {
        this.map.fitBounds(bounds, { padding: [80, 80], maxZoom: 14 });
        setTimeout(() => this.gis.cajaMapaAjustar.set(null), 100);
      }
    });

    effect(() => {
      const estado = this.gis.capasVisibles();
      const analisis = this.analisisFigura(); // Hace que este efecto reaccione cuando se enfoca/desenfoca un polígono
      if (!this.map) return;

      // --- LÓGICA CAPA COTAS ---
      if (estado.cotas) {
        this.capaCotas.addTo(this.map);
        this.map.removeLayer(this.tileBase); // Ocultar base para evitar duplicados
      } else {
        this.map.removeLayer(this.capaCotas);
        this.tileBase.addTo(this.map); // Restaurar base
      }

      // --- LÓGICA CAPA ELECTRICIDAD ---
      if (estado.electricidad) {
        this.capaElectricidad.addTo(this.map);
        if (!this.datosElectricidadCargados) this.cargarCapaElectricidad();
      } else {
        this.map.removeLayer(this.capaElectricidad);
      }

      // --- LÓGICA CAPA VÍAS HÍBRIDA (ZOOM SATELITAL) ---
      const viasActivado = estado.vias;
      if (viasActivado) {
        // Si se acaba de activar (transición false -> true) y el zoom actual es menor a 14, hacemos zoom automático
        if (!this.viasActivoAnterior) {
          const currentZoom = this.map.getZoom();
          if (currentZoom < 14) {
            this.map.setView([10.4806, -66.9036], 14, { animate: true });
          }
        }

        const zoom = this.gis.zoomLevel();
        const { zoomSatelite } = this.configService.configSignal().mapa;
        const esVistaSatelite = zoom >= zoomSatelite;

        if (esVistaSatelite) {
          this.capaSatelite.addTo(this.map);
        } else {
          this.map.removeLayer(this.capaSatelite);
        }

        if (this.capaBordeVenezuela) this.capaBordeVenezuela.addTo(this.map);
      } else {
        this.map.removeLayer(this.capaSatelite);
        if (this.capaBordeVenezuela) this.map.removeLayer(this.capaBordeVenezuela);
      }
      this.viasActivoAnterior = viasActivado;

      // Limpieza
      [this.radioBases, this.oficinas, this.abonados, this.agentes].forEach((g) => g.clearLayers());
      if (this.layerAggregated) this.layerAggregated.clearLayers();

      // --- LÓGICA CAPA 1 (GEOMETRÍA) ---
      if (estado.regiones || estado.operaciones || estado.poblacion) {
        if (estado.poblacion) {
          this.aplicarEstiloPoblacion();
        } else {
          if (this.capaGeoJsonRegiones) this.capaGeoJsonRegiones.addTo(this.map);
          if (this.capaGeoJsonParroquias) this.map.removeLayer(this.capaGeoJsonParroquias);
          this.aplicarEstiloRegiones(estado.operaciones);
        }
      } else {
        if (this.capaGeoJsonRegiones) this.map.removeLayer(this.capaGeoJsonRegiones);
        if (this.capaGeoJsonParroquias) this.map.removeLayer(this.capaGeoJsonParroquias);
      }

      if (!estado.poblacion) {
        if (this.capaGeoJsonRegiones) this.capaGeoJsonRegiones.closePopup();
        if (this.capaGeoJsonParroquias) this.capaGeoJsonParroquias.closePopup();
      }

      // --- LÓGICA DE VISUALIZACIÓN SEGÚN ZOOM ---
      const zoom = this.gis.zoomLevel();
      
      if (analisis && (analisis.tipo === 'poligono' || analisis.tipo === 'circulo' || analisis.tipo === 'ruta')) {
        // Mostrar siempre los elementos del polígono como pines individuales,
        // ocultando cualquier total o pin del resto del país.
        this.renderIndividualMarkers(['antenas', 'oficinas', 'agentes']);
      } else if (this.proyectoElementosFiltrados() !== null) {
        // Mostrar solo los elementos dentro de TODOS los polígonos del proyecto
        this.renderIndividualMarkers(['antenas', 'oficinas', 'agentes']);
      } else if (estado.operaciones) {
        const { zoomPines, zoomParroquias } = this.configService.configSignal().mapa;
        if (zoom >= zoomPines) {
          this.renderIndividualMarkers(estado.detalleOperaciones);
        } else if (zoom >= zoomParroquias) {
          this.renderParroquiaTotals(estado.detalleOperaciones);
        } else {
          this.renderStateTotals(estado.detalleOperaciones);
        }
      } else if (estado.regiones || estado.poblacion) {
        const { zoomParroquias } = this.configService.configSignal().mapa;
        if (zoom >= zoomParroquias) {
          this.renderParroquiaTotals(estado.detalleRegiones);
        } else {
          this.renderRegionTotals(estado.detalleRegiones);
        }
      }
    });

    // Reajustar tamaño del mapa Leaflet cuando el sidebar se oculta o se expande
    effect(() => {
      this.gis.sidebarColapsado();
      if (this.map) {
        setTimeout(() => this.map?.invalidateSize(), 320);
      }
    });

    // Efecto reactivo para controlar controles de dibujo de Geoman en el mapa
    effect(() => {
      const activo = this.gis.moduloPoligonosActivo();
      if (!this.map) return;

      if (!activo) {
        // Desactivar herramientas de Geoman si el módulo no está activo
        this.map.pm.disableDraw();
        if (this.map.pm.globalEditModeEnabled()) this.map.pm.disableGlobalEditMode();
        if (this.map.pm.globalRemovalModeEnabled()) this.map.pm.disableGlobalRemovalMode();
        if (this.map.pm.globalDragModeEnabled && this.map.pm.globalDragModeEnabled()) this.map.pm.disableGlobalDragMode();

        // Quitar la barra de herramientas del mapa
        this.map.pm.removeControls();

        // Limpiar figura activa y panel de análisis
        if (this.activeDrawnLayer) {
          this.map.removeLayer(this.activeDrawnLayer);
          this.activeDrawnLayer = null;
        }
        this.analisisFigura.set(null);
      } else {
        // Habilitar y mostrar la barra de herramientas de Geoman en el mapa
        this.map.pm.addControls({
          position: 'topleft',
          drawMarker: false,
          drawCircleMarker: false,
          drawPolyline: true,
          drawRectangle: true,
          drawPolygon: true,
          editMode: true,
          dragMode: true,
          cutPolygon: false,
          removalMode: true,
        });
      }
    });
  }

  ngAfterViewInit() {
    if (this.mapContainer && this.mapContainer.nativeElement) this.initMap();
  }

  private initMap() {
    const iconRetinaUrl =
      'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.7.1/images/marker-icon-2x.png';
    const iconUrl = 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.7.1/images/marker-icon.png';
    const shadowUrl =
      'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.7.1/images/marker-shadow.png';
    L.Marker.prototype.options.icon = L.icon({
      iconRetinaUrl,
      iconUrl,
      shadowUrl,
      iconSize: [25, 41],
      iconAnchor: [12, 41],
      popupAnchor: [1, -34],
      shadowSize: [41, 41],
    });

    this.map = L.map(this.mapContainer.nativeElement, {
      preferCanvas: true,
      center: [7.5, -66.1818],
      zoom: 6.3,
      zoomControl: false,
      minZoom: 5,
      maxZoom: 18,
      maxBounds: [
        [-15, -95],
        [25, -45],
      ],
      maxBoundsViscosity: 1.0,
      // preferCanvas removido: el uso de Canvas con múltiples paneles superpuestos bloquea los eventos del mouse. SVG es óptimo aquí.
    });

    this.tileBase.addTo(this.map);

    // Crear un panel especial para la electricidad para que esté siempre encima de los polígonos
    const electricPane = this.map.createPane('electricPane');
    if (electricPane) {
      electricPane.style.zIndex = '500'; // Por encima de los polígonos (400) pero debajo de marcadores (600)
      electricPane.style.pointerEvents = 'none';
    }

    // Crear un panel para las vías
    const viasPane = this.map.createPane('viasPane');
    if (viasPane) {
      viasPane.style.zIndex = '410';
      viasPane.style.pointerEvents = 'none';
    }

    // Panel para el borde (encima de las vías)
    const borderPane = this.map.createPane('borderPane');
    if (borderPane) {
      borderPane.style.zIndex = '430';
      borderPane.style.pointerEvents = 'none';
    }

    // Panel para elementos (marcadores) para que estén por encima de todo
    const elementsPane = this.map.createPane('elementsPane');
    if (elementsPane) {
      elementsPane.style.zIndex = '610'; // Por encima de markerPane (600) y etiquetas
    }

    // Crear un panel para figuras dibujadas por el usuario (Geoman) para que estén por encima de la capa base de regiones/parroquias
    const drawnPane = this.map.createPane('drawnPane');
    if (drawnPane) {
      drawnPane.style.zIndex = '450';
      drawnPane.style.pointerEvents = 'none'; // Permite clics a las capas inferiores, Leaflet maneja los clics de las figuras en SVG
    }

    this.map.on('zoomend', () => this.gis.zoomLevel.set(this.map.getZoom()));
    this.layerAggregated.addTo(this.map);

    // Configurar el panel de dibujado para usar la capa superior
    this.map.pm.setPathOptions({ pane: 'drawnPane' });

    const cachedVenezuela = this.gis.getVenezuelaGeoJson();
    const procesarVenezuela = (data: any) => {
      this.geoJsonData = data;
      this.capaGeoJsonRegiones = L.geoJSON(data, {
        style: (feature: any) => this.calcularEstiloEstado(feature),
        onEachFeature: (feature, layer) => {
          layer.on('mouseover', (e: any) => {
            const capas = this.gis.capasVisibles();
            // En zoom >= 8.5 con Demografía, las parroquias manejan el hover; regiones solo dibuja el contorno
            if (capas.poblacion && this.gis.zoomLevel() >= 8.5) return;
            if (capas.regiones || capas.operaciones || capas.poblacion) {
              (layer as L.Path).setStyle({
                weight: 3,
                color: '#ffffff',
                fillOpacity: 0.8,
              });
              if (!L.Browser.ie && !L.Browser.opera && !L.Browser.edge) {
                (layer as any).bringToFront();
              }
              const nombre = feature.properties.estado || feature.properties.name || '';
              const regionNombre = this.gis.obtenerRegion(nombre) || '';
              const regionText = regionNombre ? `Región: ${regionNombre}` : '';
              const mostrarPob = capas.poblacion;
              this.mostrarHoverInfo(nombre, regionText, e.containerPoint, {
                regionColor: regionNombre
                  ? this.gis.COLORES_REGIONES_SIGNAL()[regionNombre]
                  : undefined,
                poblacion: mostrarPob ? this.poblacionData[nombre] || 0 : undefined,
              });
            }
          });

          layer.on('mousemove', (e: any) => {
            if (this.hoverInfo()) {
              this.hoverInfo.update((h) =>
                h ? { ...h, x: e.containerPoint.x + 15, y: e.containerPoint.y + 15 } : null,
              );
            }
          });

          layer.on('mouseout', () => {
            const estado = this.gis.capasVisibles();
            if (estado.poblacion && this.gis.zoomLevel() >= 8.5) return;
            if (this.capaGeoJsonRegiones) {
              this.capaGeoJsonRegiones.resetStyle(layer as L.Path);
            }
            this.ocultarHoverInfo();
          });

          layer.on('click', (e) => {
            if (this.gis.capasVisibles().poblacion && this.gis.zoomLevel() >= 8.5) return;
            if (this.gis.capasVisibles().poblacion) {
              const nombre = feature.properties.estado || feature.properties.name;
              const pob = this.poblacionData[nombre] || 0;
              const popupHtml = this.renderer.crearPopupPoblacion(nombre, pob);
              layer.bindPopup(popupHtml, { maxWidth: 300 }).openPopup();
            } else {
              layer.unbindPopup();
            }
          });
        },
      });

      const estado = this.gis.capasVisibles();
      if (estado.regiones || estado.operaciones || estado.poblacion) {
        this.capaGeoJsonRegiones.addTo(this.map);
        if (estado.poblacion) {
          this.aplicarEstiloPoblacion();
        } else {
          this.aplicarEstiloRegiones(estado.operaciones);
        }
      }

      this.crearMascaraTerritorial(data);
    };

    if (cachedVenezuela) {
      procesarVenezuela(cachedVenezuela);
    } else {
      this.http.get('assets/geojson/venezuela.json').subscribe((data: any) => {
        this.gis.setVenezuelaGeoJson(data);
        procesarVenezuela(data);
      });
    }

    const cachedPoblacion = this.gis.getPoblacionData();
    const procesarPoblacion = (pob: any) => {
      this.poblacionData = pob;
      if (this.gis.capasVisibles().poblacion) {
        this.aplicarEstiloPoblacion();
      }
    };

    if (cachedPoblacion) {
      procesarPoblacion(cachedPoblacion);
    } else {
      this.http.get('assets/geojson/poblacion.json').subscribe({
        next: (pob: any) => {
          this.gis.setPoblacionData(pob);
          procesarPoblacion(pob);
        },
        error: (err) => console.error('Error cargando poblacion.json', err),
      });
    }

    const procesarParroquias = (data: any) => {
      this.parroquiasGeoJsonData = data;
      this.parroquiaCentros = {};
      this.areaPorEstado = {};

      // Calcular áreas totales por estado
      data.features.forEach((f: any) => {
        const estado = f.properties.adm1_name;
        const area = f.properties.area_sqkm || 0;
        if (estado) {
          this.areaPorEstado[estado] = (this.areaPorEstado[estado] || 0) + area;
        }
      });

      data.features.forEach((f: any) => {
        const pName = f.properties.adm3_name;
        const estado = f.properties.adm1_name;
        const uniqueKey = `${pName}_${estado}`;

        const cLat = f.properties.center_lat;
        const cLon = f.properties.center_lon;
        if (cLat !== undefined && cLon !== undefined) {
          this.parroquiaCentros[uniqueKey] = L.latLng(cLat, cLon);
        }
      });

      this.capaGeoJsonParroquias = L.geoJSON(data, {
        style: (feature: any) => this.calcularEstiloParroquia(feature),
        onEachFeature: (feature, layer) => {
          layer.on('mouseover', (e: any) => {
            if (this.gis.capasVisibles().poblacion && this.gis.zoomLevel() >= 8.5) {
              (layer as L.Path).setStyle({
                weight: 3,
                color: '#ffffff',
                fillOpacity: 0.8,
              });
              if (!L.Browser.ie && !L.Browser.opera && !L.Browser.edge) {
                (layer as any).bringToFront();
              }
              const name = feature.properties.adm3_name || '';
              const municipio = feature.properties.adm2_name || '';
              const estado = feature.properties.adm1_name || '';
              const area = feature.properties.area_sqkm || 0;
              const totalArea = this.areaPorEstado[estado] || 1;
              const pobParroquia = (area / totalArea) * (this.poblacionData[estado] || 0);
              const regionNombre = this.gis.obtenerRegion(estado);
              this.mostrarHoverInfo(name, `Municipio: ${municipio} - ${estado}`, e.containerPoint, {
                regionColor: this.gis.capasVisibles().regiones
                  ? this.gis.COLORES_REGIONES_SIGNAL()[regionNombre]
                  : undefined,
                poblacion: pobParroquia,
              });
            }
          });

          layer.on('mousemove', (e: any) => {
            if (this.hoverInfo()) {
              this.hoverInfo.update((h) =>
                h ? { ...h, x: e.containerPoint.x + 15, y: e.containerPoint.y + 15 } : null,
              );
            }
          });

          layer.on('mouseout', () => {
            if (this.capaGeoJsonParroquias) {
              this.capaGeoJsonParroquias.resetStyle(layer as L.Path);
            }
            this.ocultarHoverInfo();
          });

          layer.on('click', (e) => {
            if (this.gis.capasVisibles().poblacion) {
              const name = feature.properties.adm3_name;
              const municipio = feature.properties.adm2_name;
              const estado = feature.properties.adm1_name;
              const area = feature.properties.area_sqkm || 0;
              const totalArea = this.areaPorEstado[estado] || 1;
              const pobEstado = this.poblacionData[estado] || 0;
              const pob = (area / totalArea) * pobEstado;
              const popupHtml = this.renderer.crearPopupPoblacion(
                name,
                Math.round(pob),
                municipio,
                estado,
              );
              layer.bindPopup(popupHtml, { maxWidth: 300 }).openPopup();
            } else {
              layer.unbindPopup();
            }
          });
        },
      });

      const estado = this.gis.capasVisibles();
      if (estado.poblacion) {
        this.aplicarEstiloPoblacion();
      }
    };

    const cachedParroquias = this.gis.parroquiasData;
    if (cachedParroquias) {
      procesarParroquias(cachedParroquias);
    } else {
      this.gis.getParroquiasGeoJson$().subscribe({
        next: (data: any) => {
          procesarParroquias(data);
        },
        error: (err) => console.error('Error cargando parroquias.json en initMap:', err),
      });
    }

    L.control.zoom({ position: 'topright' }).addTo(this.map);

    // Configurar idioma español para Leaflet Geoman
    this.map.pm.setLang('es');

    // Escuchar la creación de nuevas figuras
    this.map.on('pm:create', (e: any) => {
      const layer = e.layer;

      // Reemplazar la figura anterior por la nueva
      if (this.activeDrawnLayer) {
        this.map.removeLayer(this.activeDrawnLayer);
      }

      // Forzar que la figura esté en el pane superior 'drawnPane'
      if (layer && layer.options) {
        this.map.removeLayer(layer);
        layer.options.pane = 'drawnPane';
        layer.addTo(this.map);
      }

      this.activeDrawnLayer = layer;

      // Realizar análisis inicial (se activa el panel flotante derecho)
      this.procesarFigura(layer);

      // Escuchar clic en la figura para volver a abrir el panel si se cerró
      layer.on('click', (ev: any) => {
        L.DomEvent.stopPropagation(ev); // Evitar que el clic se propague al mapa
        this.procesarFigura(layer);
      });

      // Escuchar modificaciones de la figura con Debounce
      layer.on('pm:edit', () => {
        if (this.pmEditDebounceTimer) clearTimeout(this.pmEditDebounceTimer);
        this.pmEditDebounceTimer = setTimeout(() => {
          this.procesarFigura(layer);
        }, 300);
      });

      // Escuchar eliminación de la figura
      layer.on('pm:remove', () => {
        if (this.activeDrawnLayer === layer) {
          this.activeDrawnLayer = null;
        }
        this.analisisFigura.set(null);
      });
    });

    // Sincronizar estados del mapa hacia el signal de modo de dibujo
    this.map.on('pm:drawend', () => {
      this.gis.modoDibujo.set(null);
    });
    this.map.on('pm:globaleditmodetoggled', (e: any) => {
      if (!e.enabled && this.gis.modoDibujo() === 'Edit') {
        this.gis.modoDibujo.set(null);
      }
    });
    this.map.on('pm:globalremovalmodetoggled', (e: any) => {
      if (!e.enabled && this.gis.modoDibujo() === 'Removal') {
        this.gis.modoDibujo.set(null);
      }
    });

    this.gis.cargarDatos();
  }

  private actualizarFigurasProyectoEnMapa(figuras: ProyectoFigura[]) {
    if (!this.map) return;
    this.projectShapesLayer.clearLayers();

    figuras.forEach((f) => {
      if (f.visible === false) return;

      let layer: L.Layer | null = null;
      const color = f.color || '#4f46e5';
      const options = {
        color: color,
        fillColor: color,
        fillOpacity: 0.25,
        weight: 3,
        pane: 'drawnPane',
      };

      let coords: any;
      try {
        coords = typeof f.coordenadas === 'string' ? JSON.parse(f.coordenadas) : f.coordenadas;
      } catch (e) {
        console.error('Error al parsear coordenadas de figura:', f, e);
        coords = f.coordenadas;
      }

      if (f.tipo === 'poligono') {
        layer = L.polygon(coords, options);
      } else if (f.tipo === 'ruta') {
        layer = L.polyline(coords, options);
      } else if (f.tipo === 'circulo' && f.radio) {
        const centro = coords;
        if (centro) {
          const lat =
            centro.lat !== undefined ? centro.lat : Array.isArray(centro) ? centro[0] : undefined;
          const lng =
            centro.lng !== undefined ? centro.lng : Array.isArray(centro) ? centro[1] : undefined;
          if (lat !== undefined && lng !== undefined) {
            layer = L.circle([lat, lng], { ...options, radius: f.radio });
          }
        }
      }

      if (layer) {
        (layer as any).dbFigura = f;
        layer.on('click', (ev: any) => {
          L.DomEvent.stopPropagation(ev);
          this.procesarFigura(ev.target, false);
        });

        layer.bindTooltip(f.nombre, { permanent: false, direction: 'center' });
        this.projectShapesLayer.addLayer(layer);
      }
    });

    this.projectShapesLayer.addTo(this.map);
  }

  private centrarCamaraEnFigura(f: ProyectoFigura) {
    if (!this.map) return;

    if (f.tipo === 'poligono' || f.tipo === 'ruta') {
      const poly = f.tipo === 'poligono' ? L.polygon(f.coordenadas) : L.polyline(f.coordenadas);
      const bounds = poly.getBounds();
      if (bounds.isValid()) {
        // Reducimos maxZoom a 11 e incrementamos padding para ver el contexto a altura moderada
        this.map.fitBounds(bounds, { padding: [120, 120], maxZoom: 11 });
      }
    } else if (f.tipo === 'circulo' && f.radio) {
      const centro = f.coordenadas;
      // Cálculo manual del Bounding Box (límites) del círculo usando trigonometría simple
      const earthRadius = 6378137; // en metros
      const dLat = (f.radio / earthRadius) * (180 / Math.PI);
      const dLng =
        (f.radio / (earthRadius * Math.cos((centro.lat * Math.PI) / 180))) * (180 / Math.PI);

      const bounds = L.latLngBounds(
        [centro.lat - dLat, centro.lng - dLng],
        [centro.lat + dLat, centro.lng + dLng],
      );

      if (bounds.isValid()) {
        this.map.fitBounds(bounds, { padding: [120, 120], maxZoom: 11 });
      }
    }
  }

  private calcularEstiloEstado(f: any): L.PathOptions {
    const capas = this.gis.capasVisibles();
    const hayCapasEspeciales = capas.cotas || capas.electricidad || capas.vias;
    const nombre = f?.properties?.estado || f?.properties?.name;

    if (capas.poblacion) {
      const combinadoRegiones = capas.regiones && !capas.operaciones;
      const combinadoEstados = capas.operaciones;
      const coloresRegiones = this.gis.COLORES_REGIONES_SIGNAL();

      if (this.gis.zoomLevel() >= 8.5) {
        const colorContorno = combinadoEstados
          ? this.gis.getColorEstado(nombre)
          : coloresRegiones[this.gis.obtenerRegion(nombre)];
        return {
          fill: false,
          fillOpacity: 0,
          color: colorContorno || '#FFFFFF',
          weight: 3,
          opacity: 1,
        };
      }

      const pob = this.poblacionData[nombre] || 0;
      const estilo = { ...this.renderer.getEstiloPoblacion(pob, hayCapasEspeciales, false), fill: true };
      if (combinadoRegiones) {
        const colorRegion = coloresRegiones[this.gis.obtenerRegion(nombre)];
        if (colorRegion) return { ...estilo, color: colorRegion, weight: 3.5, opacity: 1 };
      } else if (combinadoEstados) {
        const colorEstado = this.gis.getColorEstado(nombre);
        if (colorEstado) return { ...estilo, color: colorEstado, weight: 3, opacity: 1 };
      }
      return estilo;
    }

    const usarColorEstado = capas.operaciones;
    const estadosConDatos = new Set(this.gis.getEstadosConDatos().map((e) => e.nombre));
    const regionesActivas = this.gis.getRegionesConDatos();
    const region = this.gis.obtenerRegion(nombre);
    const tieneDatos = usarColorEstado
      ? estadosConDatos.has(nombre)
      : regionesActivas.includes(region);
    const color = usarColorEstado
      ? this.gis.getColorEstado(nombre)
      : this.gis.COLORES_REGIONES_SIGNAL()[region] || '#DEE2E6';

    return {
      fill: true,
      fillColor: tieneDatos ? color : 'transparent',
      weight: tieneDatos ? 1.5 : 0.5,
      opacity: tieneDatos ? 1 : 0.3,
      color: '#FFFFFF',
      fillOpacity: tieneDatos ? (hayCapasEspeciales ? 0.3 : 0.7) : 0,
    };
  }

  private calcularEstiloParroquia(f: any): L.PathOptions {
    const capas = this.gis.capasVisibles();
    const hayCapasEspeciales = capas.cotas || capas.electricidad || capas.vias;
    const estado = f?.properties?.adm1_name;
    const area = f?.properties?.area_sqkm || 0;
    const totalArea = this.areaPorEstado[estado] || 1;
    const pobEstado = this.poblacionData[estado] || 0;
    const pob = (area / totalArea) * pobEstado;
    return this.renderer.getEstiloPoblacion(pob, hayCapasEspeciales, true);
  }

  private aplicarEstiloRegiones(_usarColorEstado: boolean) {
    if (!this.capaGeoJsonRegiones) return;
    this.capaGeoJsonRegiones.setStyle((f: any) => this.calcularEstiloEstado(f));
  }

  private aplicarEstiloPoblacion() {
    const zoom = this.gis.zoomLevel();
    const mostrarPars = zoom >= 8.5;
    const capas = this.gis.capasVisibles();
    const hayCapasEspeciales = capas.cotas || capas.electricidad || capas.vias;
    const combinadoRegiones = capas.regiones && !capas.operaciones;
    const combinadoEstados = capas.operaciones;
    const coloresRegiones = this.gis.COLORES_REGIONES_SIGNAL();

    if (mostrarPars && this.capaGeoJsonParroquias) {
      this.capaGeoJsonParroquias.addTo(this.map);
      this.capaGeoJsonParroquias.setStyle((f: any) => {
        const estado = f.properties.adm1_name;
        const area = f.properties.area_sqkm || 0;
        const totalArea = this.areaPorEstado[estado] || 1;
        const pobEstado = this.poblacionData[estado] || 0;
        const pob = (area / totalArea) * pobEstado;
        return this.renderer.getEstiloPoblacion(pob, hayCapasEspeciales, true);
      });

      // En modo combinado con zoom >= 8.5, dibujamos solo el contorno exterior de regiones/estados encima
      if (this.capaGeoJsonRegiones) {
        if (combinadoRegiones || combinadoEstados) {
          this.capaGeoJsonRegiones.addTo(this.map);
          this.capaGeoJsonRegiones.setStyle((f: any) => {
            const nombre = f.properties.estado || f.properties.name;
            const colorContorno = combinadoEstados
              ? this.gis.getColorEstado(nombre)
              : coloresRegiones[this.gis.obtenerRegion(nombre)];
            return {
              fill: false,
              fillOpacity: 0,
              color: colorContorno || '#FFFFFF',
              weight: 3,
              opacity: 1,
            };
          });
          this.capaGeoJsonRegiones.bringToFront();
        } else {
          this.map.removeLayer(this.capaGeoJsonRegiones);
        }
      }
    } else {
      if (this.capaGeoJsonParroquias) this.map.removeLayer(this.capaGeoJsonParroquias);
      if (this.capaGeoJsonRegiones) this.capaGeoJsonRegiones.addTo(this.map);

      if (this.capaGeoJsonRegiones) {
        this.capaGeoJsonRegiones.setStyle((f: any) => {
          const nombre = f.properties.estado || f.properties.name;
          const pob = this.poblacionData[nombre] || 0;
          const estilo = { ...this.renderer.getEstiloPoblacion(pob, hayCapasEspeciales, false), fill: true };
          if (combinadoRegiones) {
            const colorRegion = coloresRegiones[this.gis.obtenerRegion(nombre)];
            if (colorRegion) return { ...estilo, color: colorRegion, weight: 3.5, opacity: 1 };
          } else if (combinadoEstados) {
            const colorEstado = this.gis.getColorEstado(nombre);
            if (colorEstado) return { ...estilo, color: colorEstado, weight: 3, opacity: 1 };
          }
          return estilo;
        });
      }
    }
  }

  private renderParroquiaTotals(tipos: TipoElemento[]) {
    this.markerService.renderParroquiaTotals(
      tipos,
      this.parroquiasGeoJsonData,
      this.parroquiaCentros,
      this.map,
      this.layerAggregated,
    );
  }

  private renderIndividualMarkers(tipos: TipoElemento[]) {
    this.markerService.renderIndividualMarkers(tipos, {
      map: this.map,
      layerAggregated: this.layerAggregated,
      groups: {
        radioBases: this.radioBases,
        oficinas: this.oficinas,
        agentes: this.agentes,
        abonados: this.abonados,
      },
      analisisFigura: this.analisisFigura(),
      proyectoElementosFiltrados: this.proyectoElementosFiltrados(),
    });
  }

  private renderStateTotals(tipos: TipoElemento[]) {
    this.markerService.renderStateTotals(tipos, this.map, this.layerAggregated);
  }

  private renderRegionTotals(tipos: TipoElemento[]) {
    this.markerService.renderRegionTotals(tipos, this.map, this.layerAggregated);
  }

  private cargarCapaElectricidad() {
    this.datosElectricidadCargados = true;
    this.http.get('assets/geojson/electricidad.json').subscribe({
      next: (data: any) => {
        this.capaElectricidadGeoJson = L.geoJSON(data, {
          pane: 'electricPane',
          style: (f) => this.renderer.getEstiloElectricidad(f),
          pointToLayer: (f, latlng) =>
            L.marker(latlng, {
              icon: this.renderer.crearIconoSubestacion(),
              pane: 'elementsPane',
            }),
          onEachFeature: (f, l) => {
            l.bindPopup(this.renderer.crearPopupElectricidad(f.properties));

            // Si es una subestación, estación o generador y está representado como un polígono,
            // calculamos su centro geográfico para posicionar el icono de rayo
            const isStation =
              f.properties &&
              (f.properties.power === 'substation' ||
                f.properties.power === 'station' ||
                f.properties.power === 'generator' ||
                f.properties.substation);

            if (isStation && typeof (l as any).getBounds === 'function') {
              const center = (l as any).getBounds().getCenter();
              const marker = L.marker(center, {
                icon: this.renderer.crearIconoSubestacion(),
                pane: 'elementsPane',
              });
              marker.bindPopup(this.renderer.crearPopupElectricidad(f.properties));
              this.capaElectricidad.addLayer(marker);
            }
          },
        });
        this.capaElectricidad.addLayer(this.capaElectricidadGeoJson);
      },
      error: () => (this.datosElectricidadCargados = false),
    });
  }

  private crearMascaraTerritorial(geoJson: any) {
    // Usamos un objeto simple para evitar colisión con el nombre de la clase 'Map'
    const segmentos: Record<string, { p1: [number, number]; p2: [number, number]; count: number }> =
      {};

    geoJson.features.forEach((feature: any) => {
      const coords =
        feature.geometry.type === 'Polygon'
          ? [feature.geometry.coordinates]
          : feature.geometry.coordinates;

      coords.forEach((polygon: any) => {
        const ring = polygon[0]; // Solo el anillo exterior de cada estado
        for (let i = 0; i < ring.length - 1; i++) {
          const p1 = ring[i];
          const p2 = ring[i + 1];
          // Crear una clave única para el segmento
          const key = [p1[0], p1[1], p2[0], p2[1]].sort((a, b) => a - b).join('|');

          if (!segmentos[key]) {
            segmentos[key] = { p1: [p1[1], p1[0]], p2: [p2[1], p2[0]], count: 0 };
          }
          segmentos[key].count++;
        }
      });
    });

    // Crear polilíneas solo con los segmentos que aparecen una sola vez
    const outlineSegments: L.Polyline[] = [];
    Object.values(segmentos).forEach((info) => {
      if (info.count === 1) {
        outlineSegments.push(
          L.polyline([info.p1, info.p2], {
            color: '#e2e2e2ff',
            weight: 2,
            interactive: false,
            pane: 'borderPane',
          }),
        );
      }
    });

    this.capaBordeVenezuela = L.layerGroup(outlineSegments) as any;

    // Si la capa de vías ya está activa, añadir el borde
    if (this.gis.capasVisibles().vias) {
      this.capaBordeVenezuela?.addTo(this.map);
    }
  }

  private procesarFigura(layer: L.Layer, esNueva: boolean = true) {
    const resultado = this.analysisService.analizarFigura(
      layer,
      esNueva,
      this.parroquiasGeoJsonData,
      (actualizado) => this.analisisFigura.set(actualizado),
    );
    this.analisisFigura.set(resultado);
  }
}
