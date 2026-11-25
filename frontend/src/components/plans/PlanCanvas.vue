<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue';
import PlanDrawing from './PlanDrawing.vue';
import {
  FREE_STEP,
  VERTEX_SNAP,
  angleSnap,
  bbox,
  connectedEnds,
  copyPoints,
  dist,
  dockCircle,
  dockShift,
  edges,
  formatNumber,
  gridStepFor,
  isRect,
  nearestWall,
  niceLength,
  pillarPolygon,
  placeOnSegment,
  pointInPolygon,
  rayHitsSegment,
  rectPoints,
  segmentInPolygon,
  snap,
  snapDetail,
  snapTargets,
  wallDirectionsAt,
  type Box,
  type Dock,
} from '../../plans/geometry';
import { OUTLINE_ID, type PlanEditor } from '../../plans/editor';
import { useToast } from '../../stores/toast';
import type { PlanPoint, PlanWall } from '../../types';

/**
 * Zeichenfläche eines Stockwerks (Pläne, Entscheide vom 20.11.2026). Ansehen: Ziehen verschiebt, Mausrad vergrössert,
 * Klick auf eine Fläche wählt sie. Bearbeiten: Umriss, Flächen (Rechteck oder Vieleck), Wände (gerade Stücke, Klick für
 * Klick), Säulen, Türen, Fenster und Beschriftungen; Ecken ziehen, in der Mitte einer Kante eine Ecke einfügen,
 * Doppelklick auf eine Ecke entfernt sie; Shift+Klick wählt mehrere Wände. Raster 5 cm, nah herangezoomt 1 cm; Ecken
 * und Kanten rasten ein, Säulen und Flächen docken an Wandseiten und Kanten an; mit Alt frei (Entscheid vom 24.11.2026).
 */
const props = defineProps<{ editor: PlanEditor }>();
const editor = props.editor;
const state = editor.state;
const toast = useToast();

const svg = ref<SVGSVGElement | null>(null);
const size = reactive({ w: 800, h: 500 });
const view = ref<Box>({ x: -2, y: -2, w: 34, h: 22 });
const panning = ref(false);

/** Bildpunkte pro Meter bei der aktuellen Ansicht */
const px = computed(() => Math.min(size.w / view.value.w, size.h / view.value.h) || 1);
const viewBox = computed(() => `${view.value.x} ${view.value.y} ${view.value.w} ${view.value.h}`);
const content = computed(() => editor.content.value);
const uiFont = computed(() => 13 / px.value);

function fit(box?: Box) {
  const b = box ?? editor.bounds.value ?? { x: 0, y: 0, w: 30, h: 18 };
  const pad = Math.max(b.w, b.h) * 0.08 + 1;
  view.value = { x: b.x - pad, y: b.y - pad, w: b.w + pad * 2, h: b.h + pad * 2 };
}

/** Auf eine Fläche zoomen und sie kurz hervorheben (Suche) */
function focusArea(id: string) {
  const area = content.value?.areas.find((a) => a.id === id);
  if (!area) return;
  const b = bbox(area.points);
  fit({ x: b.x - 4, y: b.y - 3, w: b.w + 8, h: b.h + 6 });
  state.flashId = id;
  window.setTimeout(() => {
    if (state.flashId === id) state.flashId = null;
  }, 2600);
}
defineExpose({ fit, focusArea });

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

/* Raster beim Bearbeiten: 1 m, alle 5 m kräftiger; nah herangezoomt zusätzlich fein alle 10 cm */
const gridLines = computed(() => {
  if (!editor.editing.value) return [];
  const v = view.value;
  const x0 = Math.floor(v.x);
  const x1 = Math.ceil(v.x + v.w);
  const y0 = Math.floor(v.y);
  const y1 = Math.ceil(v.y + v.h);
  if (x1 - x0 > 300 || y1 - y0 > 300) return [];
  const lines: { x1: number; y1: number; x2: number; y2: number; strong: boolean; fine?: boolean }[] = [];
  const fine = px.value >= 120 && (x1 - x0) * (y1 - y0) < 400;
  for (let x = x0; x <= x1; x++) {
    lines.push({ x1: x, y1: y0, x2: x, y2: y1, strong: x % 5 === 0 });
    if (fine && x < x1) for (let k = 1; k < 10; k++) lines.push({ x1: x + k / 10, y1: y0, x2: x + k / 10, y2: y1, strong: false, fine: true });
  }
  for (let y = y0; y <= y1; y++) {
    lines.push({ x1: x0, y1: y, x2: x1, y2: y, strong: y % 5 === 0 });
    if (fine && y < y1) for (let k = 1; k < 10; k++) lines.push({ x1: x0, y1: y + k / 10, x2: x1, y2: y + k / 10, strong: false, fine: true });
  }
  return lines;
});
// Raster je Ansicht: 5 cm, nah herangezoomt 1 cm
watch(
  px,
  (value) => {
    state.gridStep = gridStepFor(value);
  },
  { immediate: true },
);
/** Alt gedrückt: frei, ohne Raster, Einrasten und Andocken (auf den Millimeter) */
let free = false;
const step = () => (free ? FREE_STEP : state.gridStep);
const snapRadius = () => Math.min(VERTEX_SNAP, 14 / px.value);
/** Andocken bis 12 Bildpunkte, höchstens 60 cm */
const dockRadius = () => Math.min(0.6, 12 / px.value);

const pointsAttr = (points: PlanPoint[]) => points.map((p) => p.join(',')).join(' ');
/**
 * Einrasten an Ecken und Kanten (ohne die gerade bearbeiteten Formen), näher gezoomt mit kleinerem Radius; mit «faces»
 * auch an den Seiten der Wände und Säulen (für Flächen, Umriss und Messen). Merkt sich die Stelle für die Anzeige.
 */
function snapAt(p: PlanPoint, opts: { faces?: boolean; exceptLists?: PlanPoint[][]; exceptWallIds?: string[] } = {}): PlanPoint {
  const c = content.value;
  if (free || !c) {
    state.snapHint = null;
    return [snap(p[0], step()), snap(p[1], step())];
  }
  const targets = snapTargets(c, { faces: !!opts.faces, exceptLists: opts.exceptLists, exceptWallIds: opts.exceptWallIds });
  const r = snapDetail(p, targets.points, snapRadius(), targets.lines, step());
  state.snapHint = r.vertex ? { vertex: r.vertex, lines: [] } : r.edge ? { lines: [r.edge] } : null;
  return r.p;
}
/**
 * Punkt einer Wand ab «from» (Entscheid vom 25.11.2026): Ecken gehen vor; sonst rastet die Wand rechtwinklig oder in
 * Flucht zu den Bezugsrichtungen ein (ohne Bezug waagrecht oder senkrecht), auf einer Kante dort, wo die Richtung sie
 * trifft.
 */
function wallPointAt(from: PlanPoint, p: PlanPoint, refs: PlanPoint[], opts: { exceptLists?: PlanPoint[][]; exceptWallIds?: string[] } = {}): PlanPoint {
  const q = snapAt(p, opts);
  if (free || state.snapHint?.vertex) return q;
  const angle = angleSnap(from, p, refs, step());
  if (!angle) return q;
  const edge = state.snapHint?.lines[0];
  const hit = edge ? rayHitsSegment(from, angle.dir, edge[0], edge[1]) : null;
  const target = hit && dist(hit, p) < snapRadius() * 2 ? hit : angle.p;
  // Hilfslinie in der Richtung, etwas über den Punkt hinaus; beim rechten Winkel das Winkelzeichen
  const reach = 24 / px.value;
  const guide: [PlanPoint, PlanPoint] = [from, [target[0] + angle.dir[0] * reach, target[1] + angle.dir[1] * reach]];
  let corner: PlanPoint[] | undefined;
  if (angle.rightTo) {
    const s = 9 / px.value;
    const r = angle.rightTo;
    const len = Math.hypot(r[0], r[1]) || 1;
    const u: PlanPoint = [(r[0] / len) * s, (r[1] / len) * s];
    const d: PlanPoint = [angle.dir[0] * s, angle.dir[1] * s];
    corner = [
      [from[0] + u[0], from[1] + u[1]],
      [from[0] + u[0] + d[0], from[1] + u[1] + d[1]],
      [from[0] + d[0], from[1] + d[1]],
    ];
  }
  state.snapHint = { lines: hit && target === hit && edge ? [edge, guide] : [guide], corner };
  return target;
}
/** Bezugsrichtungen beim Zeichnen: die vorherige Wand, sonst die Wände am Startpunkt */
function chainRefs(pts: PlanPoint[]): PlanPoint[] {
  const d = state.draft;
  const from = pts[pts.length - 1]!;
  const lastId = state.chain[state.chain.length - 1];
  const previous = lastId ? d?.walls.find((w) => w.id === lastId) : undefined;
  if (previous) return [[previous.a[0] - from[0], previous.a[1] - from[1]]];
  return d ? wallDirectionsAt(d.walls, from) : [];
}
/** Angedockt: Kanten für die Anzeige merken */
function showDock(dock: Dock) {
  state.snapHint = dock.lines.length ? { lines: dock.lines } : null;
}
/**
 * Lage einer Säule: am Raster, dann mit ihrer Seite (eckig) bzw. ihrem Rand (rund) an Wandseiten, Kanten von Flächen
 * und Umriss und an andere Säulen andocken; in Ecken an beide Seiten.
 */
function pillarAt(p: PlanPoint, pillar: { shape: 'rect' | 'round'; width: number; depth: number; rotation: number }, exceptId?: string): PlanPoint {
  const base: PlanPoint = [snap(p[0], step()), snap(p[1], step())];
  const c = content.value;
  if (free || !c) {
    state.snapHint = null;
    return base;
  }
  const { lines } = snapTargets(c, { faces: true, exceptPillarId: exceptId });
  const dock =
    pillar.shape === 'round'
      ? dockCircle(base, pillar.width / 2, lines, dockRadius())
      : dockShift(edges(pillarPolygon({ ...pillar, x: base[0], y: base[1] }), true), lines, dockRadius());
  showDock(dock);
  return [Number((base[0] + dock.dx).toFixed(6)), Number((base[1] + dock.dy).toFixed(6))];
}
const closeDistance = () => Math.max(0.3, 10 / px.value);

/* ---------- Gewählte Form: Ecken und Kantenmitten ---------- */
type ShapeKind = 'outline' | 'area' | 'wall';
const handleShape = computed<{ kind: ShapeKind; id: string; points: PlanPoint[]; closed: boolean } | null>(() => {
  const c = content.value;
  if (!editor.editing.value || !c || state.tool !== 'select') return null;
  if (editor.outlineSelected.value && c.outline) return { kind: 'outline', id: OUTLINE_ID, points: c.outline, closed: true };
  const a = editor.selectedArea.value;
  if (a) return { kind: 'area', id: a.id, points: a.points, closed: true };
  const w = editor.selectedWall.value;
  if (w) return { kind: 'wall', id: w.id, points: [w.a, w.b], closed: false };
  return null;
});
/** Kantenmitten zum Einfügen einer Ecke: bei Umriss und Flächen (eine Wand ist ein gerades Stück) */
const midpoints = computed(() => {
  const s = handleShape.value;
  if (!s || s.kind === 'wall') return [];
  return s.points
    .map((a, i) => {
      const b = s.points[(i + 1) % s.points.length]!;
      return { i, x: (a[0] + b[0]) / 2, y: (a[1] + b[1]) / 2, long: dist(a, b) > 24 / px.value };
    })
    .filter((m) => m.long);
});

/** Ecken einer Fläche oder des Umrisses im Entwurf (live, zum Ändern) */
function livePoints(kind: 'outline' | 'area', id: string): PlanPoint[] | null {
  const d = state.draft;
  if (!d) return null;
  if (kind === 'outline') return d.outline;
  return d.areas.find((a) => a.id === id)?.points ?? null;
}
function setLivePoints(kind: 'outline' | 'area', id: string, points: PlanPoint[]) {
  const d = state.draft;
  if (!d) return;
  if (kind === 'outline') d.outline = points;
  else {
    const a = d.areas.find((x) => x.id === id);
    if (a) a.points = points;
  }
}
const wallById = (id: string): PlanWall | undefined => state.draft?.walls.find((w) => w.id === id);

/* ---------- Masse und Vorschau ---------- */
const selectedDims = computed(() => {
  const a = editor.selectedArea.value;
  if (!editor.editing.value || !a || !isRect(a.points)) return null;
  return bbox(a.points);
});
const drawingRect = computed(() => {
  const d = state.drawing;
  if (!d || !('a' in d)) return null;
  const x = Math.min(d.a[0], d.b[0]);
  const y = Math.min(d.a[1], d.b[1]);
  return { x, y, w: Math.abs(d.b[0] - d.a[0]), h: Math.abs(d.b[1] - d.a[1]) };
});
/** Vieleck beim Zeichnen; bei Wänden nur das Stück vom letzten Punkt zum Zeiger (die fertigen Stücke sind schon Wände) */
const drawingPoly = computed(() => {
  const d = state.drawing;
  if (!d || !('points' in d)) return null;
  const wall = state.tool === 'wall';
  const shown = wall ? d.points.slice(-1) : d.points;
  return { points: shown, rubber: state.cursor ? [...shown, state.cursor] : shown, wall, last: d.points[d.points.length - 1]! };
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
/** Säule unter dem Zeiger, schon angedockt (state.cursor ist beim Werkzeug «Säule» die angedockte Mitte) */
const pillarGhost = computed(() => (state.tool === 'pillar' && state.cursor ? { x: state.cursor[0], y: state.cursor[1] } : null));

/* Massstabsleiste */
const scalebar = computed(() => {
  const len = niceLength(110 / px.value);
  return { width: len * px.value, text: `${formatNumber(len, len < 1 ? 1 : 0)} m` };
});

/* ---------- Zeiger ---------- */
type WallsSnapshot = ReturnType<PlanEditor['wallsSnapshot']>;
/** Wandenden, die beim Ziehen mitgehen: die gezogene Wand und die angrenzenden Wände mit ihrem Ende dort */
type EndRef = { id: string; end: 'a' | 'b' };
type Drag =
  | { kind: 'pan'; start: [number, number]; view: Box; moved: boolean; areaId: string | null }
  | { kind: 'vertex'; shape: 'outline' | 'area'; id: string; index: number; before: PlanPoint[] }
  | { kind: 'move'; id: string; start: PlanPoint; before: PlanPoint[] }
  | { kind: 'wallEnd'; ends: EndRef[]; snapshot: WallsSnapshot }
  | { kind: 'wallMove'; id: string; start: PlanPoint; atA: EndRef[]; atB: EndRef[]; snapshot: WallsSnapshot }
  | { kind: 'point'; what: 'pillar' | 'label'; id: string; start: PlanPoint; before: PlanPoint }
  | { kind: 'opening'; id: string };
let drag: Drag | null = null;

const dataOf = (el: Element, name: string) => el.closest(`[data-${name}]`)?.getAttribute(`data-${name}`) ?? null;
const pointOf = (ref: EndRef) => wallById(ref.id)?.[ref.end] ?? null;
function setEnd(ref: EndRef, p: PlanPoint) {
  const w = wallById(ref.id);
  if (w) w[ref.end] = [p[0], p[1]];
}

function onPointerDown(e: PointerEvent) {
  if (e.button !== 0 || !content.value) return;
  free = e.altKey;
  // Ziehen wird ein Schritt beim Loslassen (Rückgängig)
  if (editor.editing.value) editor.hold(true);
  const p = toWorld(e);
  const target = e.target as Element;
  const edit = editor.editing.value;
  const d = state.draft;
  svg.value?.setPointerCapture(e.pointerId);

  switch (state.tool) {
    case 'select': {
      const shape = handleShape.value;
      const vertex = dataOf(target, 'vertex');
      const mid = dataOf(target, 'mid');
      if (edit && d && shape && (vertex !== null || mid !== null)) {
        if (shape.kind === 'wall') {
          // Ende einer Wand: angrenzende Wände mit ihrem Ende am selben Punkt gehen mit
          const end = vertex === '0' ? 'a' : 'b';
          const wall = editor.selectedWall.value!;
          const ends: EndRef[] = [{ id: wall.id, end }, ...connectedEnds(d.walls, wall[end], wall.id)];
          drag = { kind: 'wallEnd', ends, snapshot: editor.wallsSnapshot(ends.map((x) => x.id)) };
          return;
        }
        let index = Number(vertex ?? mid);
        const before = copyPoints(shape.points);
        if (mid !== null) {
          // Ecke einfügen: in der Mitte der Kante, dann gleich ziehen
          const a = shape.points[index]!;
          const b = shape.points[(index + 1) % shape.points.length]!;
          shape.points.splice(index + 1, 0, [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2]);
          index += 1;
        }
        drag = { kind: 'vertex', shape: shape.kind, id: shape.id, index, before };
        return;
      }
      const openingId = dataOf(target, 'opening');
      const pillarId = dataOf(target, 'pillar');
      const labelId = dataOf(target, 'label');
      const wallId = dataOf(target, 'wall');
      const areaId = dataOf(target, 'area');
      if (edit && d && wallId && e.shiftKey) {
        editor.toggleWall(wallId);
      } else if (edit && d && openingId) {
        editor.select('opening', openingId);
        drag = { kind: 'opening', id: openingId };
      } else if (edit && d && pillarId) {
        const pillar = d.pillars.find((x) => x.id === pillarId)!;
        editor.select('pillar', pillarId);
        drag = { kind: 'point', what: 'pillar', id: pillarId, start: p, before: [pillar.x, pillar.y] };
      } else if (edit && d && labelId) {
        const label = d.labels.find((x) => x.id === labelId)!;
        editor.select('label', labelId);
        drag = { kind: 'point', what: 'label', id: labelId, start: p, before: [label.x, label.y] };
      } else if (edit && d && wallId) {
        const wall = wallById(wallId)!;
        editor.select('wall', wallId);
        // Die Wand verschieben; angrenzende Wände bleiben mit ihrem Ende an ihr hängen
        const atA = connectedEnds(d.walls, wall.a, wall.id);
        const atB = connectedEnds(d.walls, wall.b, wall.id);
        const ids = [wall.id, ...atA.map((x) => x.id), ...atB.map((x) => x.id)];
        drag = { kind: 'wallMove', id: wallId, start: p, atA, atB, snapshot: editor.wallsSnapshot(ids) };
      } else if (edit && d && areaId) {
        const area = d.areas.find((x) => x.id === areaId)!;
        editor.select('area', areaId);
        drag = { kind: 'move', id: areaId, start: p, before: copyPoints(area.points) };
      } else if (edit && dataOf(target, 'outline')) {
        editor.select('outline');
      } else {
        drag = { kind: 'pan', start: [e.clientX, e.clientY], view: { ...view.value }, moved: false, areaId };
        panning.value = true;
      }
      return;
    }
    case 'outline':
    case 'area': {
      const q = snapAt(p, { faces: true });
      if (state.options.shape === 'rect') {
        state.drawing = { a: q, b: q };
        return;
      }
      const pts = state.drawing && 'points' in state.drawing ? state.drawing.points : [];
      if (pts.length >= 3 && dist(q, pts[0]!) < closeDistance()) finishDrawing();
      else state.drawing = { points: [...pts, q] };
      return;
    }
    case 'wall':
      wallClick(p);
      return;
    case 'pillar':
      editor.addPillar(pillarAt(p, { shape: state.options.pillarShape, width: state.options.pillarSize, depth: state.options.pillarSize, rotation: 0 }));
      state.snapHint = null;
      return;
    case 'door':
    case 'window':
      if (state.openingPreview) editor.addOpening();
      else toast.error(`${state.tool === 'window' ? 'Ein Fenster' : 'Eine Tür'} sitzt in einer Wand: auf eine Wand klicken, die lang genug ist.`);
      return;
    case 'label':
      editor.addLabel(p);
      return;
    case 'measure':
    case 'scale': {
      const key = state.tool === 'measure' ? 'measure' : 'scaleLine';
      const line = state[key];
      const q = state.tool === 'measure' ? snapAt(p, { faces: true }) : p;
      state[key] = !line?.a || line.b ? { a: q } : { a: line.a, b: q };
      state.cursor = null;
    }
  }
}

/**
 * Wände zeichnen, Klick für Klick: Jeder weitere Klick macht eine Wand vom letzten Punkt aus (ein gerades Stück). Klick
 * auf den ersten Punkt schliesst den Zug und beendet ihn, ebenso Doppelklick, Eingabetaste oder Esc.
 */
function wallClick(p: PlanPoint) {
  const outline = content.value?.outline;
  if (!outline) {
    toast.error('Zeichne zuerst den Umriss des Stockwerks oder eine Fläche.');
    return;
  }
  const pts = state.drawing && 'points' in state.drawing ? state.drawing.points : [];
  const q = pts.length ? wallPointAt(pts[pts.length - 1]!, p, chainRefs(pts)) : snapAt(p);
  if (!pts.length) {
    if (!pointInPolygon(q, outline)) toast.error('Die Wand muss im Umriss liegen.');
    else state.drawing = { points: [q] };
    return;
  }
  const last = pts[pts.length - 1]!;
  // Zweiter Klick eines Doppelklicks: keine Wand ohne Länge
  if (dist(q, last) < 0.025) return;
  const closing = pts.length >= 3 && dist(q, pts[0]!) < closeDistance();
  const end = closing ? pts[0]! : q;
  if (!segmentInPolygon(last, end, outline)) {
    toast.error('Die Wand muss im Umriss liegen.');
    return;
  }
  if (!editor.addWallPiece(last, end)) return;
  if (closing) editor.endChain();
  else state.drawing = { points: [...pts, end] };
}

/** Vieleck abschliessen (erste Ecke, Doppelklick oder Eingabetaste) bzw. das Zeichnen der Wände beenden */
function finishDrawing() {
  if (state.tool === 'wall') {
    editor.endChain();
    return;
  }
  const d = state.drawing;
  const pts = d && 'points' in d ? d.points : [];
  // Ein Doppelklick setzt die letzte Ecke doppelt
  const clean = pts.filter((p, i) => i === 0 || dist(p, pts[i - 1]!) > 0.025);
  state.drawing = null;
  state.cursor = null;
  if (clean.length < 3) return;
  if (state.tool === 'outline') editor.setOutline(clean);
  else editor.addArea(clean);
}

function onPointerMove(e: PointerEvent) {
  if (!content.value) return;
  free = e.altKey;
  const p = toWorld(e);
  const d = state.draft;
  if (drag?.kind === 'pan') {
    const dx = (e.clientX - drag.start[0]) / px.value;
    const dy = (e.clientY - drag.start[1]) / px.value;
    if (Math.abs(e.clientX - drag.start[0]) + Math.abs(e.clientY - drag.start[1]) > 3) drag.moved = true;
    view.value = { ...drag.view, x: drag.view.x - dx, y: drag.view.y - dy };
    return;
  }
  if (drag?.kind === 'vertex') {
    const pts = livePoints(drag.shape, drag.id);
    if (!pts) return;
    pts[drag.index] = snapAt(p, { faces: true, exceptLists: [pts] });
    if (drag.shape === 'outline') editor.checkOutline();
    return;
  }
  if (drag?.kind === 'move') {
    // Verschieben am Raster (die Form selbst bleibt, wie sie ist), dann mit einer Kante an Wandseiten, andere Flächen
    // oder den Umriss andocken
    const dx = snap(p[0] - drag.start[0], step());
    const dy = snap(p[1] - drag.start[1], step());
    let moved = drag.before.map(([x, y]): PlanPoint => [x + dx, y + dy]);
    if (!free && content.value) {
      const { lines } = snapTargets(content.value, { faces: true, exceptAreaId: drag.id });
      const dock = dockShift(edges(moved, true), lines, dockRadius());
      showDock(dock);
      moved = moved.map(([x, y]): PlanPoint => [Number((x + dock.dx).toFixed(6)), Number((y + dock.dy).toFixed(6))]);
    } else state.snapHint = null;
    setLivePoints('area', drag.id, moved);
    return;
  }
  if (drag?.kind === 'wallEnd' && d) {
    const moving = drag.ends.map((r) => pointOf(r)).filter((x): x is PlanPoint => !!x);
    const ids = [...new Set(drag.ends.map((r) => r.id))];
    // Rechtwinklig zu den Wänden am festen Ende der gezogenen Wand
    const own = wallById(drag.ends[0]!.id);
    const fixed = own ? own[drag.ends[0]!.end === 'a' ? 'b' : 'a'] : null;
    const q = fixed
      ? wallPointAt([fixed[0], fixed[1]], p, wallDirectionsAt(d.walls, fixed, [own!.id]), { exceptLists: [moving], exceptWallIds: ids })
      : snapAt(p, { exceptLists: [moving], exceptWallIds: ids });
    for (const r of drag.ends) setEnd(r, q);
    editor.refitOpenings(drag.snapshot);
    return;
  }
  if (drag?.kind === 'wallMove' && d) {
    const id = drag.id;
    const before = drag.snapshot.walls.find((w) => w.id === id)!;
    const dx = snap(p[0] - drag.start[0], step());
    const dy = snap(p[1] - drag.start[1], step());
    const a: PlanPoint = [before.a[0] + dx, before.a[1] + dy];
    const b: PlanPoint = [before.b[0] + dx, before.b[1] + dy];
    setEnd({ id: drag.id, end: 'a' }, a);
    setEnd({ id: drag.id, end: 'b' }, b);
    for (const r of drag.atA) setEnd(r, a);
    for (const r of drag.atB) setEnd(r, b);
    editor.refitOpenings(drag.snapshot);
    return;
  }
  if (drag?.kind === 'point' && d) {
    const id = drag.id;
    const target: PlanPoint = [drag.before[0] + p[0] - drag.start[0], drag.before[1] + p[1] - drag.start[1]];
    if (drag.what === 'pillar') {
      const pillar = d.pillars.find((x) => x.id === id);
      if (!pillar) return;
      [pillar.x, pillar.y] = pillarAt(target, pillar, pillar.id);
      return;
    }
    const label = d.labels.find((x) => x.id === id);
    if (!label) return;
    label.x = snap(target[0], step());
    label.y = snap(target[1], step());
    return;
  }
  if (drag?.kind === 'opening' && d) {
    const id = drag.id;
    const o = d.openings.find((x) => x.id === id);
    const hit = o ? nearestWall(p, d.walls, 1) : null;
    const offset = o && hit ? placeOnSegment(hit.along, hit.length, o.width, step()) : null;
    if (o && hit && offset !== null) Object.assign(o, { wallId: hit.wall.id, offset });
    return;
  }
  if ((state.tool === 'outline' || state.tool === 'area') && state.drawing && 'a' in state.drawing) {
    state.drawing.b = snapAt(p, { faces: true });
    return;
  }
  if (state.tool === 'door' || state.tool === 'window') {
    const kind = state.tool === 'window' ? 'window' : state.options.doorKind;
    // Zweiflüglig: zusammen so breit wie beide Flügel
    const leaves = state.options.leaves;
    const width = kind === 'double' ? Number((leaves[0] + leaves[1]).toFixed(6)) : state.options.widths[kind];
    const hit = d ? nearestWall(p, d.walls, 12 / px.value) : null;
    const offset = hit ? placeOnSegment(hit.along, hit.length, width, step()) : null;
    state.openingPreview =
      hit && offset !== null
        ? { wallId: hit.wall.id, offset, width, kind, hinge: 'start', side: 'left', ...(kind === 'double' ? { leaf: leaves[0] } : {}) }
        : null;
    return;
  }
  const waiting = (l: { a: PlanPoint; b?: PlanPoint } | null) => !!l?.a && !l.b;
  if (state.tool === 'pillar') {
    state.cursor = pillarAt(p, { shape: state.options.pillarShape, width: state.options.pillarSize, depth: state.options.pillarSize, rotation: 0 });
  } else if (state.tool === 'wall') {
    const pts = state.drawing && 'points' in state.drawing ? state.drawing.points : [];
    state.cursor = pts.length ? wallPointAt(pts[pts.length - 1]!, p, chainRefs(pts)) : snapAt(p);
  } else if (['outline', 'area'].includes(state.tool) || (state.tool === 'measure' && waiting(state.measure))) {
    state.cursor = snapAt(p, { faces: true });
  } else {
    if (state.tool === 'scale' && waiting(state.scaleLine)) state.cursor = p;
    state.snapHint = null;
  }
}

function onPointerUp() {
  const dr = drag;
  drag = null;
  panning.value = false;
  if (dr) state.snapHint = null;
  // Nach allem, was das Loslassen noch ändert (unten), ein Schritt
  window.setTimeout(() => editor.editing.value && editor.hold(false), 0);
  const d = state.draft;
  if (dr?.kind === 'pan' && !dr.moved) editor.select(dr.areaId ? 'area' : null, dr.areaId ?? undefined);
  if (dr?.kind === 'vertex' && d) commitShape(dr.shape, dr.id, dr.before);
  if (dr?.kind === 'move' && d) commitShape('area', dr.id, dr.before);
  if ((dr?.kind === 'wallEnd' || dr?.kind === 'wallMove') && d) editor.commitWalls(dr.snapshot);
  if (dr?.kind === 'point' && d) {
    const item = dr.what === 'pillar' ? d.pillars.find((x) => x.id === dr.id) : d.labels.find((x) => x.id === dr.id);
    if (item) editor.commitPoint(item, dr.before, dr.what === 'pillar' ? 'Die Säule' : 'Die Beschriftung');
  }
  if ((state.tool === 'outline' || state.tool === 'area') && state.drawing && 'a' in state.drawing) {
    const r = drawingRect.value!;
    state.drawing = null;
    if (r.w < 0.3 || r.h < 0.3) return;
    const pts = rectPoints(r.x, r.y, r.w, r.h);
    if (state.tool === 'outline') editor.setOutline(pts);
    else editor.addArea(pts);
  }
}

/** Nach dem Ziehen: Umriss umschliesst alles, Flächen lassen ihn wachsen */
function commitShape(kind: 'outline' | 'area', id: string, before: PlanPoint[]) {
  const d = state.draft;
  if (!d) return;
  if (kind === 'outline') editor.commitOutline(before);
  else {
    const area = d.areas.find((a) => a.id === id);
    if (area) editor.commitArea(area, before);
  }
}

/** Doppelklick: Vieleck abschliessen, Zeichnen der Wände beenden, sonst eine Ecke der gewählten Form entfernen */
function onDblClick(e: MouseEvent) {
  if (state.tool === 'wall' || (state.drawing && 'points' in state.drawing)) {
    finishDrawing();
    return;
  }
  const vertex = dataOf(e.target as Element, 'vertex');
  const shape = handleShape.value;
  if (vertex === null || !shape || shape.kind === 'wall') return;
  if (shape.points.length <= 3) {
    toast.error('Weniger Ecken geht nicht.');
    return;
  }
  const before = copyPoints(shape.points);
  setLivePoints(
    shape.kind,
    shape.id,
    before.filter((_, i) => i !== Number(vertex)),
  );
  commitShape(shape.kind, shape.id, before);
}

function onWheel(e: WheelEvent) {
  zoom(e.deltaY > 0 ? 1.15 : 1 / 1.15, toWorld(e));
}

/** Alt beim Bearbeiten: frei zeichnen, ohne dass der Browser sein Menü öffnet */
function onAltKey(e: KeyboardEvent) {
  if (e.key === 'Alt' && editor.editing.value) e.preventDefault();
}

function onKey(e: KeyboardEvent) {
  onAltKey(e);
  const typing = ['INPUT', 'TEXTAREA', 'SELECT'].includes((document.activeElement as HTMLElement | null)?.tagName ?? '');
  const drawing = state.drawing && 'points' in state.drawing ? state.drawing : null;
  if (e.key === 'Escape') {
    if (state.tool === 'wall' && drawing) {
      editor.endChain();
      return;
    }
    state.drawing = null;
    state.cursor = null;
    state.measure = null;
    state.scaleLine = null;
    state.openingPreview = null;
    if (!typing) editor.select(null);
    return;
  }
  if (typing || !editor.editing.value) return;
  // Rückgängig: Ctrl+Z, Wiederholen: Ctrl+Y bzw. Ctrl+Shift+Z
  if ((e.ctrlKey || e.metaKey) && (e.key === 'z' || e.key === 'Z' || e.key === 'y' || e.key === 'Y')) {
    e.preventDefault();
    if (e.key.toLowerCase() === 'y' || e.shiftKey) editor.redo();
    else editor.undo();
    return;
  }
  if (e.key === 'Enter' && drawing) {
    e.preventDefault();
    finishDrawing();
    return;
  }
  if (e.key === 'Backspace' && drawing) {
    e.preventDefault();
    // Wände: die letzte Wand zurücknehmen; Vieleck: die letzte Ecke
    if (state.tool === 'wall' && drawing.points.length > 1) editor.undoWallPiece();
    drawing.points.pop();
    if (!drawing.points.length) state.drawing = null;
    return;
  }
  if ((e.key === 'Delete' || e.key === 'Backspace') && state.selection) {
    e.preventDefault();
    if (state.selection.kind === 'area') state.confirmDelete = true;
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
  document.addEventListener('keyup', onAltKey);
});
onBeforeUnmount(() => {
  observer?.disconnect();
  document.removeEventListener('keydown', onKey);
  document.removeEventListener('keyup', onAltKey);
});
// Anderes Stockwerk: ganzes Stockwerk zeigen
watch(
  () => state.floor?.id,
  () => fit(),
  { immediate: true },
);
// Werkzeug gewechselt: Vorschau weg
watch(
  () => state.tool,
  () => {
    state.openingPreview = null;
    state.cursor = null;
    state.snapHint = null;
  },
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
      @pointerleave="
        state.openingPreview = null;
        state.snapHint = null;
      "
      @dblclick="onDblClick"
      @wheel.prevent="onWheel"
    >
      <g v-if="gridLines.length">
        <line
          v-for="(l, i) in gridLines"
          :key="i"
          class="grid"
          :class="{ strong: l.strong, fine: l.fine }"
          :x1="l.x1"
          :y1="l.y1"
          :x2="l.x2"
          :y2="l.y2"
          vector-effect="non-scaling-stroke"
        />
      </g>
      <PlanDrawing
        v-if="content"
        :content="content"
        :layers="editor.layers.value"
        uid="screen"
        :editing="editor.editing.value"
        :selection="state.selection"
        :flash-id="state.flashId"
        :px="px"
        :outline-invalid="state.outlineInvalid"
        :preview="state.openingPreview"
      />

      <!-- Bearbeiten: Ecken und Kantenmitten der gewählten Form -->
      <template v-if="handleShape">
        <circle v-for="m in midpoints" :key="`m-${m.i}`" class="mid-handle" :data-mid="m.i" :cx="m.x" :cy="m.y" :r="4 / px" vector-effect="non-scaling-stroke">
          <title>Ziehen fügt eine Ecke ein</title>
        </circle>
        <circle
          v-for="(p, i) in handleShape.points"
          :key="`v-${i}`"
          class="handle"
          :data-vertex="i"
          :cx="p[0]"
          :cy="p[1]"
          :r="6 / px"
          vector-effect="non-scaling-stroke"
        >
          <title>Ziehen verschiebt die Ecke, Doppelklick entfernt sie</title>
        </circle>
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
        <polyline v-if="drawingPoly.wall" class="draft-wall" :points="pointsAttr(drawingPoly.rubber)" :stroke-width="state.options.wallThickness" />
        <polyline class="draft" :points="pointsAttr(drawingPoly.rubber)" vector-effect="non-scaling-stroke" />
        <circle v-for="(p, i) in drawingPoly.points" :key="`p-${i}`" class="handle" :cx="p[0]" :cy="p[1]" :r="5 / px" vector-effect="non-scaling-stroke" />
        <text
          v-if="state.cursor"
          class="dim"
          :stroke-width="3 / px"
          :x="(drawingPoly.last[0] + state.cursor[0]) / 2"
          :y="(drawingPoly.last[1] + state.cursor[1]) / 2 - 6 / px"
          text-anchor="middle"
          :font-size="uiFont"
        >
          {{ formatNumber(dist(drawingPoly.last, state.cursor), 2) }} m
        </text>
      </template>
      <g v-if="pillarGhost" class="ghost" :transform="`translate(${pillarGhost.x} ${pillarGhost.y})`">
        <circle v-if="state.options.pillarShape === 'round'" :r="state.options.pillarSize / 2" />
        <rect v-else :x="-state.options.pillarSize / 2" :y="-state.options.pillarSize / 2" :width="state.options.pillarSize" :height="state.options.pillarSize" />
      </g>

      <!-- Woran gerade etwas einrastet oder andockt -->
      <g v-if="editor.editing.value && state.snapHint" class="snap-hint">
        <line
          v-for="(l, i) in state.snapHint.lines"
          :key="`s-${i}`"
          :x1="l[0][0]"
          :y1="l[0][1]"
          :x2="l[1][0]"
          :y2="l[1][1]"
          vector-effect="non-scaling-stroke"
        />
        <circle v-if="state.snapHint.vertex" :cx="state.snapHint.vertex[0]" :cy="state.snapHint.vertex[1]" :r="8 / px" vector-effect="non-scaling-stroke" />
        <polyline v-if="state.snapHint.corner" class="corner" :points="pointsAttr(state.snapHint.corner)" vector-effect="non-scaling-stroke" />
      </g>

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

    <div v-if="editor.editing.value && content?.plan && !content.plan.calibrated" class="plan-status">
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
      <span v-if="editor.editing.value" class="grid-info">Raster {{ Math.round(state.gridStep * 100) }} cm · Alt: frei</span>
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
.tool-outline,
.tool-area,
.tool-wall,
.tool-pillar,
.tool-door,
.tool-window,
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
.grid.fine {
  stroke: color-mix(in srgb, var(--surface-2) 55%, transparent);
}
.snap-hint line {
  stroke: var(--accent);
  stroke-width: 2.5;
  stroke-dasharray: 6 3;
  pointer-events: none;
}
.snap-hint .corner {
  fill: none;
  stroke: var(--accent);
  stroke-width: 2;
  pointer-events: none;
}
.snap-hint circle {
  fill: none;
  stroke: var(--accent);
  stroke-width: 2;
  pointer-events: none;
}
.grid-info {
  margin-top: 2px;
}
.handle {
  fill: var(--surface);
  stroke: var(--accent);
  stroke-width: 1.6;
  cursor: move;
}
.mid-handle {
  fill: var(--accent);
  fill-opacity: 0.45;
  stroke: var(--surface);
  stroke-width: 1;
  cursor: copy;
}
.mid-handle:hover {
  fill-opacity: 1;
}
.draft {
  fill: color-mix(in srgb, var(--accent) 18%, transparent);
  stroke: var(--accent);
  stroke-width: 1.6;
  stroke-dasharray: 5 4;
}
polyline.draft {
  fill: none;
}
.draft-wall {
  fill: none;
  stroke: color-mix(in srgb, var(--text) 45%, transparent);
  stroke-linecap: square;
  stroke-linejoin: miter;
}
.ghost {
  fill: color-mix(in srgb, var(--accent) 45%, transparent);
  pointer-events: none;
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
