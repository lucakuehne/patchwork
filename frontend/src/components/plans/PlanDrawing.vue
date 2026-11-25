<script setup lang="ts">
import { computed } from 'vue';
import {
  AREA_KIND_LABELS,
  AREA_WITHOUT_SIZE,
  bbox,
  centroid,
  crossLines,
  formatNumber,
  labelSize,
  openingDrawing,
  openingFrame,
  polygonArea,
  stairLines,
  wallBand,
  wallPolygons,
} from '../../plans/geometry';
import type { FloorContent, Layers, OpeningDraft, PlanSelection } from '../../plans/editor';
import type { PlanArea, PlanPoint } from '../../types';

/**
 * Zeichnung eines Stockwerks (Entscheide vom 20.11.2026), auf dem Bildschirm und im Druck gleich: Plan im Hintergrund,
 * Umriss, Flächen nach Art (Treppenhaus mit Strichen, Lift und Schacht mit Kreuz), Wände mit Lücken für Türen und
 * Fenster, Säulen, Namen und Beschriftungen. Klicks wertet die Zeichenfläche über die data-Attribute aus.
 */
const props = defineProps<{
  content: FloorContent;
  layers: Layers;
  /** Eindeutig je Zeichnung (Bildschirm, Druck), für Masken und Ausschnitte */
  uid: string;
  print?: boolean;
  editing?: boolean;
  selection?: PlanSelection | null;
  flashId?: string | null;
  /** Bildpunkte pro Meter, für Klickflächen dünner Teile */
  px?: number;
  outlineInvalid?: boolean;
  preview?: OpeningDraft | null;
}>();

const pointsAttr = (points: PlanPoint[]) => points.map((p) => p.join(',')).join(' ');
const isSelected = (kind: PlanSelection['kind'], id: string) =>
  (props.selection?.kind === kind && props.selection.id === id) ||
  (kind === 'wall' && props.selection?.kind === 'walls' && !!props.selection.ids?.includes(id));
const hitWidth = computed(() => 10 / (props.px ?? 40));
/** Linien in Bildpunkten auf dem Bildschirm; im Druck in Metern (sonst wären sie auf Papier kaum sichtbar) */
const ve = computed(() => (props.print ? undefined : 'non-scaling-stroke'));

const areas = computed(() =>
  props.content.areas.map((a: PlanArea) => {
    const [cx, cy] = centroid(a.points);
    const named = !!a.name.trim();
    const title = named ? a.name.trim() : AREA_KIND_LABELS[a.kind];
    const fs = labelSize(title, bbox(a.points).w) * (named ? 1 : 0.85);
    const marks = a.kind === 'stairs' ? stairLines(a.points) : a.kind === 'elevator' || a.kind === 'shaft' ? crossLines(a.points) : [];
    return {
      ...a,
      attr: pointsAttr(a.points),
      cx,
      cy,
      title,
      named,
      fs,
      size: AREA_WITHOUT_SIZE.includes(a.kind) ? '' : `${formatNumber(polygonArea(a.points))} m²`,
      marks,
    };
  }),
);

/** Wände als Vierecke mit sauberen Ecken; die Klickfläche liegt auf der Mitte der Dicke */
const walls = computed(() => {
  const polygons = wallPolygons(props.content.walls);
  return props.content.walls.map((w) => {
    const { n, lo, hi } = wallBand(w);
    const mid = (lo + hi) / 2;
    return {
      id: w.id,
      thickness: w.thickness,
      attr: pointsAttr(polygons.get(w.id) ?? []),
      x1: w.a[0] + n[0] * mid,
      y1: w.a[1] + n[1] * mid,
      x2: w.b[0] + n[0] * mid,
      y2: w.b[1] + n[1] * mid,
    };
  });
});
const openings = computed(() => {
  const list = [
    ...props.content.openings.map((o) => ({ o, id: o.id, preview: false })),
    ...(props.preview ? [{ o: props.preview, id: 'preview', preview: true }] : []),
  ];
  return list.flatMap(({ o, id, preview }) => {
    const f = openingFrame(o, props.content.walls);
    if (!f) return [];
    const d = openingDrawing(o, f, hitWidth.value / 2);
    return [{ id, preview, kind: o.kind, gap: pointsAttr(d.gap), hit: pointsAttr(d.hit), leaves: d.leaves, arcs: d.arcs, lines: d.lines }];
  });
});
/** Maske der Wände: weiss zeigt, die Lücken der Türen und Fenster schwarz */
const maskBox = computed(() => {
  const pts = [...(props.content.outline ?? []), ...props.content.walls.flatMap((w) => [w.a, w.b])];
  if (!pts.length) return { x: 0, y: 0, w: 1, h: 1 };
  const b = bbox(pts);
  return { x: b.x - 5, y: b.y - 5, w: b.w + 10, h: b.h + 10 };
});
const pillarTransform = (p: { x: number; y: number; rotation: number }) => `translate(${p.x} ${p.y}) rotate(${p.rotation})`;
</script>

<template>
  <g class="plan-drawing" :class="{ print, editing }">
    <defs>
      <mask :id="`${uid}-walls`" maskUnits="userSpaceOnUse" :x="maskBox.x" :y="maskBox.y" :width="maskBox.w" :height="maskBox.h">
        <rect :x="maskBox.x" :y="maskBox.y" :width="maskBox.w" :height="maskBox.h" fill="white" />
        <polygon v-for="o in openings" :key="`m-${o.id}`" :points="o.gap" fill="black" />
      </mask>
      <clipPath v-for="a in areas.filter((x) => x.marks.length)" :id="`${uid}-clip-${a.id}`" :key="`c-${a.id}`">
        <polygon :points="a.attr" />
      </clipPath>
    </defs>

    <!-- Plan im Hintergrund -->
    <image
      v-if="content.plan && layers.plan"
      class="plan-image"
      :href="content.plan.url"
      :x="content.plan.x"
      :y="content.plan.y"
      :width="content.plan.widthPx * content.plan.metersPerPx"
      :height="content.plan.heightPx * content.plan.metersPerPx"
      preserveAspectRatio="none"
    />

    <!-- Umriss: immer sichtbar -->
    <polygon
      v-if="content.outline"
      class="outline"
      :class="{ selected: isSelected('outline', 'outline'), invalid: outlineInvalid }"
      :points="pointsAttr(content.outline)"
      :vector-effect="ve"
    />
    <polygon v-if="editing && content.outline" class="hit-stroke" data-outline="1" :points="pointsAttr(content.outline)" :stroke-width="hitWidth" />

    <!-- Flächen -->
    <template v-if="layers.areas">
      <polygon
        v-for="a in areas"
        :key="a.id"
        class="area"
        :class="[`k-${a.kind}`, { selected: isSelected('area', a.id), flash: flashId === a.id }]"
        :data-area="a.id"
        :points="a.attr"
        :vector-effect="ve"
      >
        <title>{{ a.title }}</title>
      </polygon>
      <g v-for="a in areas.filter((x) => x.marks.length)" :key="`k-${a.id}`" class="area-marks" :class="`k-${a.kind}`" :clip-path="`url(#${uid}-clip-${a.id})`">
        <line v-for="(l, i) in a.marks" :key="i" :x1="l[0][0]" :y1="l[0][1]" :x2="l[1][0]" :y2="l[1][1]" :vector-effect="ve" />
      </g>
    </template>

    <!-- Bauteile: Wände (mit Lücken), Säulen, Türen und Fenster -->
    <template v-if="layers.structure">
      <g class="walls" :mask="`url(#${uid}-walls)`">
        <polygon v-for="w in walls" :key="w.id" class="wall" :class="{ selected: isSelected('wall', w.id) }" :points="w.attr" />
      </g>
      <template v-if="editing">
        <line
          v-for="w in walls"
          :key="`h-${w.id}`"
          class="hit-stroke"
          :data-wall="w.id"
          :x1="w.x1"
          :y1="w.y1"
          :x2="w.x2"
          :y2="w.y2"
          :stroke-width="Math.max(w.thickness, hitWidth)"
        />
      </template>
      <g v-for="p in content.pillars" :key="p.id" class="pillar" :class="{ selected: isSelected('pillar', p.id) }" :data-pillar="p.id" :transform="pillarTransform(p)">
        <circle v-if="p.shape === 'round'" :r="p.width / 2" />
        <rect v-else :x="-p.width / 2" :y="-p.depth / 2" :width="p.width" :height="p.depth" />
      </g>
      <g v-for="o in openings" :key="`o-${o.id}`" class="opening" :class="{ preview: o.preview, selected: isSelected('opening', o.id) }">
        <line v-for="(l, i) in o.leaves" :key="`l-${i}`" class="leaf" :x1="l[0][0]" :y1="l[0][1]" :x2="l[1][0]" :y2="l[1][1]" :vector-effect="ve" />
        <path v-for="(d, i) in o.arcs" :key="`a-${i}`" class="swing" :d="d" :vector-effect="ve" />
        <line v-for="(l, i) in o.lines" :key="`w-${i}`" class="glass" :x1="l[0][0]" :y1="l[0][1]" :x2="l[1][0]" :y2="l[1][1]" :vector-effect="ve" />
      </g>
      <template v-if="editing">
        <polygon v-for="o in openings.filter((x) => !x.preview)" :key="`h-${o.id}`" class="hit-fill" :class="{ selected: isSelected('opening', o.id) }" :data-opening="o.id" :points="o.hit" />
      </template>
    </template>

    <!-- Namen der Flächen -->
    <template v-if="layers.areas">
      <g v-for="a in areas" :key="`t-${a.id}`" class="area-text">
        <text class="area-name" :class="{ unnamed: !a.named }" :x="a.cx" :y="a.cy - (a.size ? a.fs * 0.15 : -a.fs * 0.35)" text-anchor="middle" :font-size="a.fs">
          {{ a.title }}
        </text>
        <text v-if="a.size" class="area-size" :x="a.cx" :y="a.cy + a.fs * 1.05" text-anchor="middle" :font-size="a.fs * 0.78">{{ a.size }}</text>
      </g>
    </template>

    <!-- Beschriftungen -->
    <template v-if="layers.labels">
      <text
        v-for="l in content.labels"
        :key="l.id"
        class="free-label"
        :class="{ selected: isSelected('label', l.id) }"
        :data-label="l.id"
        :x="l.x"
        :y="l.y"
        text-anchor="middle"
        font-size="0.55"
      >
        {{ l.text }}
      </text>
    </template>
  </g>
</template>

<style scoped>
/* Farben je Art: auf dem Bildschirm halbdurchsichtig (hell und dunkel), im Druck helle Töne */
.plan-drawing {
  --k-room: var(--accent);
  --k-corridor: #b09a6a;
  --k-entrance: #3f9f5f;
  --k-stairs: #7a8699;
  --k-elevator: #7a8699;
  --k-open: #d9a92b;
  --k-shaft: #5d6879;
  --k-outdoor: #2a9d8f;
  /* Deckend (nicht durchsichtig): wo Wände übereinander liegen, wird es sonst dunkler */
  --wall: color-mix(in srgb, var(--text) 88%, var(--plan-bg, var(--surface)));
}
.plan-image {
  opacity: 0.6;
}
:global(:root[data-theme='dark']) .plan-drawing:not(.print) .plan-image {
  filter: invert(0.9) hue-rotate(180deg);
}
.outline {
  fill: color-mix(in srgb, var(--text) 4%, transparent);
  stroke: color-mix(in srgb, var(--text) 45%, transparent);
  stroke-width: 1.2;
  stroke-dasharray: 6 3;
  pointer-events: none;
}
.outline.selected {
  stroke: var(--accent);
  stroke-width: 2.4;
  stroke-dasharray: none;
}
.outline.invalid {
  stroke: var(--danger);
  fill: color-mix(in srgb, var(--danger) 8%, transparent);
}
.area {
  --k: var(--k-room);
  fill: color-mix(in srgb, var(--k) 14%, transparent);
  stroke: color-mix(in srgb, var(--k) 75%, transparent);
  stroke-width: 1.2;
  cursor: pointer;
}
.area:hover {
  fill: color-mix(in srgb, var(--k) 22%, transparent);
}
.area.selected {
  fill: color-mix(in srgb, var(--k) 30%, transparent);
  stroke: var(--accent);
  stroke-width: 2.4;
}
.area.flash {
  animation: flash 1.2s ease-out 2;
}
@keyframes flash {
  50% {
    fill: color-mix(in srgb, var(--accent) 45%, transparent);
  }
}
@media (prefers-reduced-motion: reduce) {
  .area.flash {
    animation: none;
  }
}
.k-corridor {
  --k: var(--k-corridor);
}
.k-entrance {
  --k: var(--k-entrance);
}
.k-stairs {
  --k: var(--k-stairs);
}
.k-elevator {
  --k: var(--k-elevator);
}
.k-open {
  --k: var(--k-open);
}
.k-shaft {
  --k: var(--k-shaft);
}
.area.k-shaft {
  fill: color-mix(in srgb, var(--k) 30%, transparent);
}
.k-outdoor {
  --k: var(--k-outdoor);
}
.area.k-outdoor {
  stroke-dasharray: 5 3;
}
.area-marks line {
  stroke: color-mix(in srgb, var(--k) 70%, transparent);
  stroke-width: 1;
  pointer-events: none;
}
.wall {
  fill: var(--wall);
  pointer-events: none;
}
.wall.selected {
  fill: var(--accent);
}
.pillar {
  fill: var(--wall);
}
.editing .pillar {
  cursor: move;
}
.pillar.selected {
  fill: var(--accent);
}
.plan-drawing:not(.editing) .pillar {
  pointer-events: none;
}
.opening .leaf {
  stroke: var(--wall);
  stroke-width: 1.4;
}
.opening .swing {
  fill: none;
  stroke: color-mix(in srgb, var(--text) 50%, transparent);
  stroke-width: 1;
  stroke-dasharray: 3 2;
}
.opening .glass {
  stroke: var(--wall);
  stroke-width: 1;
}
.opening {
  pointer-events: none;
}
.opening.preview .leaf,
.opening.preview .glass,
.opening.preview .swing {
  stroke: var(--accent);
}
.opening.selected .leaf,
.opening.selected .glass {
  stroke: var(--accent);
}
.area-text text {
  pointer-events: none;
}
.area-name {
  fill: var(--text);
  font-weight: 600;
}
.area-name.unnamed {
  fill: var(--text-muted);
  font-weight: 400;
  font-style: italic;
}
.area-size {
  fill: var(--text-muted);
  font-variant-numeric: tabular-nums;
}
.free-label {
  fill: var(--text-muted);
  font-style: italic;
}
.editing .free-label {
  cursor: move;
}
.free-label.selected {
  fill: var(--accent);
  font-weight: 600;
}
.hit-stroke {
  fill: none;
  stroke: transparent;
  pointer-events: stroke;
  cursor: pointer;
}
.hit-fill {
  fill: transparent;
  cursor: move;
}
.hit-fill.selected {
  fill: color-mix(in srgb, var(--accent) 25%, transparent);
}

/* Druck: feste helle Farben, Linien in Metern statt Bildpunkten */
.print {
  --k-room: #3a5bd9;
  --wall: #1c2330;
}
.print .plan-image {
  opacity: 0.45;
}
.print .outline {
  fill: #f6f7f9;
  stroke: #9aa3b2;
  stroke-width: 0.03;
  stroke-dasharray: none;
}
.print .area {
  fill: color-mix(in srgb, var(--k) 12%, #ffffff);
  stroke: color-mix(in srgb, var(--k) 70%, #1c2330);
  stroke-width: 0.03;
}
.print .area.k-shaft {
  fill: color-mix(in srgb, var(--k) 30%, #ffffff);
}
.print .area.k-outdoor {
  stroke-dasharray: 0.15 0.1;
}
.print .area-marks line {
  stroke-width: 0.02;
}
.print .opening .leaf {
  stroke-width: 0.03;
}
.print .opening .swing {
  stroke: #5d6879;
  stroke-width: 0.02;
  stroke-dasharray: 0.08 0.05;
}
.print .opening .glass {
  stroke-width: 0.02;
}
.print .area-name {
  fill: #1c2330;
}
.print .area-name.unnamed,
.print .area-size,
.print .free-label {
  fill: #5d6879;
}
</style>
