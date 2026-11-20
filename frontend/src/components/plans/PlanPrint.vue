<script setup lang="ts">
import { computed } from 'vue';
import PlanDrawing from './PlanDrawing.vue';
import { formatNumber, polygonArea, printScale, type Box } from '../../plans/geometry';
import type { FloorContent, Layers } from '../../plans/editor';

/**
 * Druck eines Stockwerks (Entscheide vom 20.11.2026): A4 quer im üblichen Massstab (z.B. 1:200), mit Umriss, Flächen,
 * Bauteilen, Beschriftungen (nach den gewählten Ebenen) und Massstabsleiste. Auf dem Bildschirm unsichtbar; «Drucken»
 * öffnet den Druckdialog des Browsers, dort auch «Als PDF speichern».
 */
const props = defineProps<{ title: string; content: FloorContent; bounds: Box; layers: Layers }>();

/** Rand um das Stockwerk und Platz für die Massstabsleiste, in Metern */
const PAD = 1;
const BAR_SPACE = 3;
const view = computed(() => ({
  x: props.bounds.x - PAD,
  y: props.bounds.y - PAD,
  w: props.bounds.w + PAD * 2,
  h: props.bounds.h + PAD * 2 + BAR_SPACE,
}));
const scale = computed(() => printScale(view.value.w, view.value.h));
/** Grösse auf dem Papier in Millimetern: massstabsgetreu */
const paper = computed(() => ({ w: (view.value.w * 1000) / scale.value, h: (view.value.h * 1000) / scale.value }));
const barMeters = computed(() => (scale.value <= 100 ? 2 : scale.value <= 250 ? 5 : scale.value <= 500 ? 10 : 20));
const barY = computed(() => props.bounds.y + props.bounds.h + PAD + 1.2);
const rooms = computed(() => props.content.areas.filter((a) => a.kind === 'room').length);
const outlineArea = computed(() => (props.content.outline ? polygonArea(props.content.outline) : 0));
const today = new Intl.DateTimeFormat('de-CH', { day: '2-digit', month: '2-digit', year: 'numeric' }).format(new Date());
</script>

<template>
  <Teleport to="body">
    <div class="plan-print-root" aria-hidden="true">
      <div class="sheet">
        <div class="sheet-head">
          <strong>{{ title }}</strong>
          <span>{{ rooms }} {{ rooms === 1 ? 'Raum' : 'Räume' }}<template v-if="outlineArea"> · Umriss {{ formatNumber(outlineArea) }} m²</template></span>
        </div>
        <svg
          class="sheet-plan"
          :viewBox="`${view.x} ${view.y} ${view.w} ${view.h}`"
          :style="{ width: `${paper.w}mm`, height: `${paper.h}mm` }"
          xmlns="http://www.w3.org/2000/svg"
        >
          <PlanDrawing :content="content" :layers="layers" uid="print" print />
          <g stroke="#1c2330" stroke-width="0.06" fill="none">
            <line :x1="bounds.x" :y1="barY" :x2="bounds.x + barMeters" :y2="barY" />
            <line :x1="bounds.x" :y1="barY - 0.3" :x2="bounds.x" :y2="barY + 0.3" />
            <line :x1="bounds.x + barMeters" :y1="barY - 0.3" :x2="bounds.x + barMeters" :y2="barY + 0.3" />
          </g>
          <text :x="bounds.x + barMeters + 0.4" :y="barY + 0.2" font-size="0.6" fill="#1c2330">{{ barMeters }} m</text>
        </svg>
        <div class="sheet-foot">
          <span>Massstab 1:{{ scale }} auf A4 quer · Norden oben</span>
          <span>Patchwork · Stand {{ today }}</span>
        </div>
      </div>
    </div>
  </Teleport>
</template>

<style>
/* Auf dem Bildschirm unsichtbar; beim Drucken nur dieses Blatt */
.plan-print-root {
  display: none;
}
@media print {
  @page {
    size: A4 landscape;
    margin: 10mm;
  }
  body > *:not(.plan-print-root) {
    display: none !important;
  }
  .plan-print-root {
    display: block !important;
    color: #1c2330;
    background: #ffffff;
    font-family: var(--font);
  }
  .plan-print-root .sheet {
    display: flex;
    flex-direction: column;
    gap: 4mm;
  }
  .plan-print-root .sheet-head {
    display: flex;
    justify-content: space-between;
    align-items: baseline;
    border-bottom: 0.3mm solid #1c2330;
    padding-bottom: 2mm;
    font-size: 11pt;
  }
  .plan-print-root .sheet-head strong {
    font-size: 13pt;
  }
  .plan-print-root .sheet-plan {
    display: block;
    margin: 0 auto;
  }
  .plan-print-root .sheet-foot {
    display: flex;
    justify-content: space-between;
    font-size: 9pt;
    color: #5d6879;
  }
}
</style>
