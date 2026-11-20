<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue';
import {
  bbox,
  centroid,
  dist,
  formatNumber,
  isRect,
  labelSize,
  niceLength,
  polygonArea,
  rectPoints,
  snap,
  snapPoint,
  type Box,
} from '../../plans/geometry';
import type { PlanEditor } from '../../plans/editor';
import type { PlanPoint, PlanRoom } from '../../types';

/**
 * Zeichenfläche eines Stockwerks (Pläne, Entscheid vom 20.11.2026): Plan im Hintergrund, Räume mit Name und Fläche,
 * Beschriftungen. Ansehen: Ziehen verschiebt, Mausrad vergrössert, Klick auf einen Raum wählt ihn. Bearbeiten: Rechteck,
 * Vieleck, Beschriftung, Ecken verschieben, Massstab setzen; Raster 10 cm, Ecken anderer Räume rasten ein.
 */
const props = defineProps<{ editor: PlanEditor }>();
const editor = props.editor;
const state = editor.state;


const svg = ref<SVGSVGElement | null>(null);
const size = reactive({ w: 800, h: 500 });
const view = ref<Box>({ x: -2, y: -2, w: 34, h: 22 });
const panning = ref(false);

/** Bildpunkte pro Meter bei der aktuellen Ansicht */
const px = computed(() => Math.min(size.w / view.value.w, size.h / view.value.h) || 1);
const viewBox = computed(() => `${view.value.x} ${view.value.y} ${view.value.w} ${view.value.h}`);
const content = computed(() => editor.content.value);
const plan = computed(() => content.value?.plan ?? null);
const uiFont = computed(() => 13 / px.value);

function fit(box?: Box) {
  const b = box ?? editor.bounds.value ?? { x: 0, y: 0, w: 30, h: 18 };
  const pad = Math.max(b.w, b.h) * 0.08 + 1;
  view.value = { x: b.x - pad, y: b.y - pad, w: b.w + pad * 2, h: b.h + pad * 2 };
}

/** Auf einen Raum zoomen und ihn kurz hervorheben (Suche) */
function focusRoom(id: string) {
  const room = content.value?.rooms.find((r) => r.id === id);
  if (!room) return;
  const b = bbox(room.points);
  fit({ x: b.x - 4, y: b.y - 3, w: b.w + 8, h: b.h + 6 });
  state.flashId = id;
  window.setTimeout(() => {
    if (state.flashId === id) state.flashId = null;
  }, 2600);
}
defineExpose({ fit, focusRoom });

function zoom(factor: number, center?: PlanPoint) {
  const v = view.value;
  const [cx, cy] = center ?? [v.x + v.w / 2, v.y + v.h / 2];
  view.value = { x: cx - (cx - v.x) * factor, y: cy - (cy - v.y) * factor, w: v.w * factor, h: v.h * factor };
}

function toWorld(e: { clientX: number; clientY: number }): PlanPoint {
  const el = svg.value!;
  const pt = el.createSVGPoint();
  pt.x = e.clientX;
  pt.y = e.clientY;
  const p = pt.matrixTransform(el.getScreenCTM()!.inverse());
  return [p.x, p.y];
}

/* Raster beim Bearbeiten: 1 m, alle 5 m kräftiger */
const gridLines = computed(() => {
  if (!editor.editing.value) return [];
  const v = view.value;
  const x0 = Math.floor(v.x);
  const x1 = Math.ceil(v.x + v.w);
  const y0 = Math.floor(v.y);
  const y1 = Math.ceil(v.y + v.h);
  if (x1 - x0 > 300 || y1 - y0 > 300) return [];
  const lines: { x1: number; y1: number; x2: number; y2: number; strong: boolean }[] = [];
  for (let x = x0; x <= x1; x++) lines.push({ x1: x, y1: y0, x2: x, y2: y1, strong: x % 5 === 0 });
  for (let y = y0; y <= y1; y++) lines.push({ x1: x0, y1: y, x2: x1, y2: y, strong: y % 5 === 0 });
  return lines;
});

const pointsAttr = (points: PlanPoint[]) => points.map((p) => p.join(',')).join(' ');
function roomText(r: PlanRoom) {
  const [cx, cy] = centroid(r.points);
  const name = r.name.trim() || 'Ohne Namen';
  const fs = labelSize(name, bbox(r.points).w);
  return { cx, cy, name, fs, area: `${formatNumber(polygonArea(r.points))} m²` };
}

/** Masse beim Zeichnen und am gewählten Rechteck */
const selectedDims = computed(() => {
  const r = editor.selectedRoom.value;
  if (!editor.editing.value || !r || !isRect(r.points)) return null;
  return bbox(r.points);
});
const drawingRect = computed(() => {
  const d = state.drawing;
  if (!d || !('a' in d)) return null;
  const x = Math.min(d.a[0], d.b[0]);
  const y = Math.min(d.a[1], d.b[1]);
  return { x, y, w: Math.abs(d.b[0] - d.a[0]), h: Math.abs(d.b[1] - d.a[1]) };
});
const drawingPoly = computed(() => {
  const d = state.drawing;
  if (!d || !('points' in d)) return null;
  return { points: d.points, rubber: state.cursor ? [...d.points, state.cursor] : d.points };
});
const lines = computed(() =>
  [
    { line: state.measure, scale: false },
    { line: state.scaleLine, scale: true },
  ]
    .filter((l) => l.line?.a)
    .map(({ line, scale }) => {
      const b = line!.b ?? state.cursor;
      return { a: line!.a, b, text: b ? `${formatNumber(dist(line!.a, b), 2)} m${scale ? ' (laut Plan)' : ''}` : '' };
    }),
);

/* Massstabsleiste */
const scalebar = computed(() => {
  const len = niceLength(110 / px.value);
  return { width: len * px.value, text: `${formatNumber(len, len < 1 ? 1 : 0)} m` };
});

/* ---------- Zeiger ---------- */
type Drag =
  | { kind: 'pan'; start: [number, number]; view: Box; moved: boolean; roomId: string | null }
  | { kind: 'vertex'; index: number }
  | { kind: 'room'; start: PlanPoint; orig: PlanPoint[] }
  | { kind: 'label'; start: PlanPoint; orig: PlanPoint };
let drag: Drag | null = null;

const rooms = () => content.value?.rooms ?? [];

function onPointerDown(e: PointerEvent) {
  if (e.button !== 0 || !content.value) return;
  const p = toWorld(e);
  const target = e.target as Element;
  const roomEl = target.closest('[data-room]') as HTMLElement | null;
  const labelEl = target.closest('[data-label]') as HTMLElement | null;
  const vertexEl = target.closest('[data-vertex]') as HTMLElement | null;
  const edit = editor.editing.value;
  svg.value?.setPointerCapture(e.pointerId);

  switch (state.tool) {
    case 'select': {
      if (edit && vertexEl) {
        drag = { kind: 'vertex', index: Number(vertexEl.dataset.vertex) };
      } else if (edit && roomEl) {
        editor.select('room', roomEl.dataset.room);
        const room = editor.selectedRoom.value!;
        drag = { kind: 'room', start: p, orig: room.points.map((q): PlanPoint => [q[0], q[1]]) };
      } else if (edit && labelEl) {
        editor.select('label', labelEl.dataset.label);
        const label = editor.selectedLabel.value!;
        drag = { kind: 'label', start: p, orig: [label.x, label.y] };
      } else {
        drag = { kind: 'pan', start: [e.clientX, e.clientY], view: { ...view.value }, moved: false, roomId: roomEl?.dataset.room ?? null };
        panning.value = true;
      }
      return;
    }
    case 'rect': {
      const q = snapPoint(p, rooms());
      state.drawing = { a: q, b: q };
      return;
    }
    case 'poly': {
      const q = snapPoint(p, rooms());
      const pts = state.drawing && 'points' in state.drawing ? state.drawing.points : [];
      if (pts.length >= 3 && dist(q, pts[0]!) < Math.max(0.4, 10 / px.value)) {
        finishPolygon();
        return;
      }
      state.drawing = { points: [...pts, q] };
      return;
    }
    case 'label':
      editor.addLabel(p);
      return;
    case 'measure':
    case 'scale': {
      const key = state.tool === 'measure' ? 'measure' : 'scaleLine';
      const line = state[key];
      const q = state.tool === 'measure' ? snapPoint(p, rooms()) : p;
      state[key] = !line?.a || line.b ? { a: q } : { a: line.a, b: q };
      state.cursor = null;
    }
  }
}

function onPointerMove(e: PointerEvent) {
  if (!content.value) return;
  const p = toWorld(e);
  if (drag?.kind === 'pan') {
    const dx = (e.clientX - drag.start[0]) / px.value;
    const dy = (e.clientY - drag.start[1]) / px.value;
    if (Math.abs(e.clientX - drag.start[0]) + Math.abs(e.clientY - drag.start[1]) > 3) drag.moved = true;
    view.value = { ...drag.view, x: drag.view.x - dx, y: drag.view.y - dy };
    return;
  }
  const room = editor.selectedRoom.value;
  if (drag?.kind === 'vertex' && room) {
    room.points[drag.index] = snapPoint(p, rooms(), room);
    return;
  }
  if (drag?.kind === 'room' && room) {
    const dx = snap(p[0] - drag.start[0]);
    const dy = snap(p[1] - drag.start[1]);
    room.points = drag.orig.map(([x, y]): PlanPoint => [snap(x + dx), snap(y + dy)]);
    return;
  }
  const label = editor.selectedLabel.value;
  if (drag?.kind === 'label' && label) {
    label.x = snap(drag.orig[0] + p[0] - drag.start[0]);
    label.y = snap(drag.orig[1] + p[1] - drag.start[1]);
    return;
  }
  if (state.tool === 'rect' && state.drawing && 'a' in state.drawing) {
    state.drawing.b = snapPoint(p, rooms());
    return;
  }
  const waiting = (l: { a: PlanPoint; b?: PlanPoint } | null) => !!l?.a && !l.b;
  if (state.tool === 'poly' || (state.tool === 'measure' && waiting(state.measure))) state.cursor = snapPoint(p, rooms());
  else if (state.tool === 'scale' && waiting(state.scaleLine)) state.cursor = p;
}

function onPointerUp() {
  const d = drag;
  drag = null;
  panning.value = false;
  if (d?.kind === 'pan' && !d.moved) editor.select(d.roomId ? 'room' : null, d.roomId ?? undefined);
  if (state.tool === 'rect' && state.drawing && 'a' in state.drawing) {
    const r = drawingRect.value!;
    state.drawing = null;
    if (r.w >= 0.5 && r.h >= 0.5) editor.addRoom(rectPoints(r.x, r.y, snap(r.w), snap(r.h)));
  }
}

function finishPolygon() {
  const d = state.drawing;
  const pts = d && 'points' in d ? d.points : [];
  // Ein Doppelklick setzt den letzten Punkt doppelt
  const clean = pts.filter((p, i) => i === 0 || dist(p, pts[i - 1]!) > 0.05);
  state.drawing = null;
  state.cursor = null;
  if (clean.length >= 3) editor.addRoom(clean);
}

function onWheel(e: WheelEvent) {
  zoom(e.deltaY > 0 ? 1.15 : 1 / 1.15, toWorld(e));
}

function onKey(e: KeyboardEvent) {
  const typing = ['INPUT', 'TEXTAREA', 'SELECT'].includes((document.activeElement as HTMLElement | null)?.tagName ?? '');
  if (e.key === 'Escape') {
    state.drawing = null;
    state.cursor = null;
    state.measure = null;
    state.scaleLine = null;
    if (!typing) editor.select(null);
    return;
  }
  if (typing || !editor.editing.value) return;
  if (e.key === 'Backspace' && state.tool === 'poly' && state.drawing && 'points' in state.drawing) {
    e.preventDefault();
    state.drawing.points.pop();
    if (!state.drawing.points.length) state.drawing = null;
    return;
  }
  if ((e.key === 'Delete' || e.key === 'Backspace') && state.selection) {
    e.preventDefault();
    if (state.selection.kind === 'room') state.confirmDelete = true;
    else editor.deleteSelected();
  }
}

let observer: ResizeObserver | null = null;
onMounted(() => {
  observer = new ResizeObserver(() => {
    if (!svg.value) return;
    size.w = svg.value.clientWidth;
    size.h = svg.value.clientHeight;
  });
  if (svg.value) observer.observe(svg.value);
  document.addEventListener('keydown', onKey);
});
onBeforeUnmount(() => {
  observer?.disconnect();
  document.removeEventListener('keydown', onKey);
});
// Anderes Stockwerk: ganzes Stockwerk zeigen
watch(
  () => state.floor?.id,
  () => fit(),
  { immediate: true },
);
</script>

<template>
  <div class="stage" :class="[`tool-${state.tool}`, { panning }]">
    <svg
      ref="svg"
      :viewBox="viewBox"
      preserveAspectRatio="xMidYMid meet"
      role="img"
      aria-label="Grundriss des Stockwerks"
      @pointerdown="onPointerDown"
      @pointermove="onPointerMove"
      @pointerup="onPointerUp"
      @pointercancel="onPointerUp"
      @dblclick="state.tool === 'poly' && finishPolygon()"
      @wheel.prevent="onWheel"
    >
      <g v-if="gridLines.length">
        <line
          v-for="(l, i) in gridLines"
          :key="i"
          class="grid"
          :class="{ strong: l.strong }"
          :x1="l.x1"
          :y1="l.y1"
          :x2="l.x2"
          :y2="l.y2"
          vector-effect="non-scaling-stroke"
        />
      </g>
      <image
        v-if="plan && state.showPlan"
        class="plan-image"
        :href="plan.url"
        :x="plan.x"
        :y="plan.y"
        :width="plan.widthPx * plan.metersPerPx"
        :height="plan.heightPx * plan.metersPerPx"
        preserveAspectRatio="none"
      />
      <template v-if="content">
        <polygon
          v-for="r in content.rooms"
          :key="r.id"
          class="room"
          :class="{ selected: state.selection?.kind === 'room' && state.selection.id === r.id, flash: state.flashId === r.id }"
          :data-room="r.id"
          :points="pointsAttr(r.points)"
          vector-effect="non-scaling-stroke"
        >
          <title>{{ r.name }}</title>
        </polygon>
        <g v-for="r in content.rooms" :key="`t-${r.id}`" class="room-text">
          <text class="room-name" :x="roomText(r).cx" :y="roomText(r).cy - roomText(r).fs * 0.15" text-anchor="middle" :font-size="roomText(r).fs">
            {{ roomText(r).name }}
          </text>
          <text class="room-area" :x="roomText(r).cx" :y="roomText(r).cy + roomText(r).fs * 1.05" text-anchor="middle" :font-size="roomText(r).fs * 0.78">
            {{ roomText(r).area }}
          </text>
        </g>
        <text
          v-for="l in content.labels"
          :key="l.id"
          class="free-label"
          :class="{ selected: state.selection?.kind === 'label' && state.selection.id === l.id, editable: editor.editing.value }"
          :data-label="l.id"
          :x="l.x"
          :y="l.y"
          text-anchor="middle"
          font-size="0.55"
        >
          {{ l.text }}
        </text>
      </template>

      <!-- Bearbeiten: Ecken und Masse des gewählten Raums -->
      <template v-if="editor.editing.value && editor.selectedRoom.value">
        <circle
          v-for="(p, i) in editor.selectedRoom.value.points"
          :key="`v-${i}`"
          class="handle"
          :data-vertex="i"
          :cx="p[0]"
          :cy="p[1]"
          :r="6 / px"
          vector-effect="non-scaling-stroke"
        />
      </template>
      <template v-if="selectedDims">
        <text class="dim" :stroke-width="3 / px" :x="selectedDims.x + selectedDims.w / 2" :y="selectedDims.y - 8 / px" text-anchor="middle" :font-size="uiFont">
          {{ formatNumber(selectedDims.w) }} m
        </text>
        <text class="dim" :stroke-width="3 / px" :x="selectedDims.x + selectedDims.w + 6 / px" :y="selectedDims.y + selectedDims.h / 2" :font-size="uiFont">
          {{ formatNumber(selectedDims.h) }} m
        </text>
      </template>

      <!-- Zeichnen -->
      <template v-if="drawingRect">
        <rect class="draft" :x="drawingRect.x" :y="drawingRect.y" :width="drawingRect.w" :height="drawingRect.h" vector-effect="non-scaling-stroke" />
        <text class="dim" :stroke-width="3 / px" :x="drawingRect.x + drawingRect.w / 2" :y="drawingRect.y + drawingRect.h / 2" text-anchor="middle" :font-size="uiFont">
          {{ formatNumber(drawingRect.w) }} × {{ formatNumber(drawingRect.h) }} m · {{ formatNumber(drawingRect.w * drawingRect.h) }} m²
        </text>
      </template>
      <template v-if="drawingPoly">
        <polyline class="draft" :points="pointsAttr(drawingPoly.rubber)" vector-effect="non-scaling-stroke" />
        <circle v-for="(p, i) in drawingPoly.points" :key="`p-${i}`" class="handle" :cx="p[0]" :cy="p[1]" :r="5 / px" vector-effect="non-scaling-stroke" />
        <text
          v-if="state.cursor && drawingPoly.points.length"
          class="dim"
          :stroke-width="3 / px"
          :x="(drawingPoly.points[drawingPoly.points.length - 1]![0] + state.cursor[0]) / 2"
          :y="(drawingPoly.points[drawingPoly.points.length - 1]![1] + state.cursor[1]) / 2 - 6 / px"
          text-anchor="middle"
          :font-size="uiFont"
        >
          {{ formatNumber(dist(drawingPoly.points[drawingPoly.points.length - 1]!, state.cursor), 2) }} m
        </text>
      </template>

      <!-- Messen und Massstab setzen -->
      <g v-for="(l, i) in lines" :key="`m-${i}`">
        <circle class="measure-dot" :cx="l.a[0]" :cy="l.a[1]" :r="4 / px" />
        <template v-if="l.b">
          <line class="measure-line" :x1="l.a[0]" :y1="l.a[1]" :x2="l.b[0]" :y2="l.b[1]" vector-effect="non-scaling-stroke" />
          <circle class="measure-dot" :cx="l.b[0]" :cy="l.b[1]" :r="4 / px" />
          <text class="measure-text" :stroke-width="3 / px" :x="(l.a[0] + l.b[0]) / 2" :y="(l.a[1] + l.b[1]) / 2 - 8 / px" text-anchor="middle" :font-size="uiFont * 1.05">
            {{ l.text }}
          </text>
        </template>
      </g>
    </svg>

    <div v-if="editor.editing.value && plan && !plan.calibrated" class="plan-status">
      Massstab noch nicht gesetzt: «Massstab setzen» wählen und eine bekannte Strecke auf dem Plan anklicken.
    </div>
    <div class="zoom">
      <button class="btn" type="button" title="Vergrössern" aria-label="Vergrössern" @click="zoom(1 / 1.3)">+</button>
      <button class="btn" type="button" title="Verkleinern" aria-label="Verkleinern" @click="zoom(1.3)">−</button>
      <button class="btn" type="button" title="Ganzes Stockwerk zeigen" aria-label="Ganzes Stockwerk zeigen" @click="fit()">⤢</button>
    </div>
    <div class="scalebar" aria-hidden="true">
      <div class="bar" :style="{ width: `${scalebar.width}px` }" />
      <span>{{ scalebar.text }}</span>
    </div>
    <svg class="north" viewBox="0 0 34 44" aria-label="Norden oben">
      <path d="M17 4 L25 24 L17 19 L9 24 Z" fill="currentColor" />
      <text x="17" y="38" text-anchor="middle" font-size="11" fill="currentColor" font-weight="600">N</text>
    </svg>
  </div>
</template>

<style scoped>
.stage {
  position: relative;
  height: clamp(380px, calc(100vh - 290px), 760px);
  background: var(--plan-bg, var(--surface));
  touch-action: none;
  overflow: hidden;
}
.stage svg:first-child {
  width: 100%;
  height: 100%;
  display: block;
  user-select: none;
}
.tool-select {
  cursor: grab;
}
.panning {
  cursor: grabbing;
}
.tool-rect,
.tool-poly,
.tool-label,
.tool-measure,
.tool-scale {
  cursor: crosshair;
}
.grid {
  stroke: var(--surface-2);
  stroke-width: 1;
}
.grid.strong {
  stroke: var(--border);
}
.plan-image {
  opacity: 0.6;
}
:global(:root[data-theme='dark']) .plan-image {
  filter: invert(0.9) hue-rotate(180deg);
}
.room {
  fill: color-mix(in srgb, var(--accent) 8%, transparent);
  stroke: var(--accent);
  stroke-width: 1.4;
  cursor: pointer;
}
.room:hover {
  fill: color-mix(in srgb, var(--accent) 15%, transparent);
}
.room.selected {
  fill: color-mix(in srgb, var(--accent) 24%, transparent);
  stroke-width: 2.4;
}
.room.flash {
  animation: flash 1.2s ease-out 2;
}
@keyframes flash {
  50% {
    fill: color-mix(in srgb, var(--accent) 45%, transparent);
  }
}
@media (prefers-reduced-motion: reduce) {
  .room.flash {
    animation: none;
  }
}
.room-text text {
  pointer-events: none;
}
.room-name {
  fill: var(--text);
  font-weight: 600;
}
.room-area {
  fill: var(--text-muted);
  font-variant-numeric: tabular-nums;
}
.free-label {
  fill: var(--text-muted);
  font-style: italic;
}
.free-label.editable {
  cursor: move;
}
.free-label.selected {
  fill: var(--accent);
  font-weight: 600;
}
.handle {
  fill: var(--surface);
  stroke: var(--accent);
  stroke-width: 1.6;
  cursor: move;
}
.draft {
  fill: color-mix(in srgb, var(--accent) 18%, transparent);
  stroke: var(--accent);
  stroke-width: 1.6;
  stroke-dasharray: 5 4;
}
.dim {
  fill: var(--accent);
  font-weight: 600;
  pointer-events: none;
  paint-order: stroke;
  stroke: var(--plan-bg, var(--surface));
  font-variant-numeric: tabular-nums;
}
.measure-line {
  stroke: var(--warning);
  stroke-width: 2;
  stroke-dasharray: 6 4;
}
.measure-dot {
  fill: var(--warning);
}
.measure-text {
  fill: var(--warning);
  font-weight: 700;
  pointer-events: none;
  paint-order: stroke;
  stroke: var(--plan-bg, var(--surface));
}
.zoom {
  position: absolute;
  right: 10px;
  top: 10px;
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.zoom .btn {
  width: 32px;
  padding: 0;
}
.scalebar {
  position: absolute;
  left: 12px;
  bottom: 12px;
  display: flex;
  flex-direction: column;
  gap: 2px;
  font-size: 11px;
  color: var(--text-muted);
  font-variant-numeric: tabular-nums;
  background: color-mix(in srgb, var(--surface) 85%, transparent);
  padding: 4px 6px;
  border-radius: 4px;
}
.scalebar .bar {
  height: 6px;
  border: 1.5px solid var(--text-muted);
  border-top: 0;
}
.north {
  position: absolute;
  right: 12px;
  bottom: 12px;
  width: 34px;
  height: 44px;
  color: var(--text-muted);
}
.plan-status {
  position: absolute;
  left: 12px;
  top: 10px;
  max-width: calc(100% - 70px);
  font-size: 12px;
  background: var(--warning-soft);
  color: var(--warning);
  border-radius: var(--radius-sm);
  padding: 4px 8px;
}
</style>
