<script setup lang="ts">
import { computed } from 'vue';
import { bbox, centroid, formatNumber, labelSize, polygonArea, printScale, type Box } from '../../plans/geometry';
import type { FloorContent } from '../../plans/editor';
import type { PlanPoint } from '../../types';

/**
 * Druck eines Stockwerks (Entscheid vom 20.11.2026): A4 quer im üblichen Massstab (z.B. 1:200), mit Namen, Flächen,
 * Beschriftungen und Massstabsleiste. Auf dem Bildschirm unsichtbar; «Drucken» öffnet den Druckdialog des Browsers,
 * dort auch «Als PDF speichern».
 */
const props = defineProps<{ title: string; content: FloorContent; bounds: Box; showPlan: boolean }>();

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
const total = computed(() => props.content.rooms.reduce((s, r) => s + polygonArea(r.points), 0));
const today = new Intl.DateTimeFormat('de-CH', { day: '2-digit', month: '2-digit', year: 'numeric' }).format(new Date());

const pointsAttr = (points: PlanPoint[]) => points.map((p) => p.join(',')).join(' ');
const rooms = computed(() =>
  props.content.rooms.map((r) => {
    const [cx, cy] = centroid(r.points);
    const fs = labelSize(r.name, bbox(r.points).w);
    return { id: r.id, points: pointsAttr(r.points), name: r.name, cx, cy, fs, area: `${formatNumber(polygonArea(r.points))} m²` };
  }),
);
</script>

<template>
  <Teleport to="body">
    <div class="plan-print-root" aria-hidden="true">
      <div class="sheet">
        <div class="sheet-head">
          <strong>{{ title }}</strong>
          <span>{{ content.rooms.length }} Räume · {{ formatNumber(total) }} m²</span>
        </div>
        <svg
          class="sheet-plan"
          :viewBox="`${view.x} ${view.y} ${view.w} ${view.h}`"
          :style="{ width: `${paper.w}mm`, height: `${paper.h}mm` }"
          xmlns="http://www.w3.org/2000/svg"
        >
          <image
            v-if="content.plan && showPlan"
            :href="content.plan.url"
            :x="content.plan.x"
            :y="content.plan.y"
            :width="content.plan.widthPx * content.plan.metersPerPx"
            :height="content.plan.heightPx * content.plan.metersPerPx"
            preserveAspectRatio="none"
            opacity="0.45"
          />
          <polygon v-for="r in rooms" :key="r.id" :points="r.points" fill="#f1f4fd" stroke="#1c2330" stroke-width="0.04" />
          <g v-for="r in rooms" :key="`t-${r.id}`">
            <text :x="r.cx" :y="r.cy - r.fs * 0.15" text-anchor="middle" :font-size="r.fs" font-weight="600" fill="#1c2330">{{ r.name }}</text>
            <text :x="r.cx" :y="r.cy + r.fs * 1.05" text-anchor="middle" :font-size="r.fs * 0.78" fill="#5d6879">{{ r.area }}</text>
          </g>
          <text v-for="l in content.labels" :key="l.id" :x="l.x" :y="l.y" text-anchor="middle" font-size="0.55" font-style="italic" fill="#5d6879">
            {{ l.text }}
          </text>
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
