import { Component, inject, computed, ChangeDetectionStrategy } from '@angular/core';
import { GisService } from '../../services/gis/gisService';
import { ConfigService } from '../../services/config/configService';
import { TipoElemento } from '../../models/gis';
import { CommonModule } from '@angular/common';

@Component({
  selector: 'app-totales',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './totales.html',
  changeDetection: ChangeDetectionStrategy.Eager,
  styleUrl: './totales.css',
})
export class Totales {
  public gis = inject(GisService);
  public config = inject(ConfigService);

  totalAntenas = computed(() => this.gis.radioBasesSignal().length);
  totalOficinas = computed(() => this.gis.oficinasSignal().length);
  totalAgentes = computed(() => this.gis.agentesSignal().length);

  totalAbonados3G = computed(() =>
    this.gis
      .abonadosSignal()
      .filter((a) => a.segmentacion === '3G')
      .reduce((acc, curr) => acc + (Number(curr.cantidad) || 0), 0),
  );

  totalAbonados4G = computed(() =>
    this.gis
      .abonadosSignal()
      .filter((a) => a.segmentacion === '4G')
      .reduce((acc, curr) => acc + (Number(curr.cantidad) || 0), 0),
  );

  // Suma total general de abonados
  totalAbonados = computed(() =>
    this.gis.abonadosSignal().reduce((acc, curr) => acc + (Number(curr.cantidad) || 0), 0),
  );
  // Se muestra si hay alguna capa territorial activa (Estados, Zonas Regionales o Demografía)
  visible = computed(() => {
    const capas = this.gis.capasVisibles();
    return capas.operaciones || capas.regiones || capas.poblacion;
  });

  hayFiltroActivo = computed(() => {
    const capas = this.gis.capasVisibles();
    const lista = capas.operaciones ? capas.detalleOperaciones : capas.detalleRegiones;
    return lista.length > 0;
  });

  esActivo(tipo: TipoElemento): boolean {
    const capas = this.gis.capasVisibles();
    const lista = capas.operaciones ? capas.detalleOperaciones : capas.detalleRegiones;
    return lista.includes(tipo);
  }

  toggleElemento(tipo: TipoElemento) {
    if (this.gis.capasVisibles().operaciones) {
      this.gis.setDetalleOperaciones(tipo);
    } else {
      this.gis.setDetalleRegiones(tipo);
    }
  }

  formatear(valor: number): string {
    return new Intl.NumberFormat('de-DE').format(valor);
  }
}
