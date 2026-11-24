import { computed, reactive } from 'vue';
import { api } from '../api';
import { useToast } from '../stores/toast';
import type {
  PlanArea,
  PlanAreaKind,
  PlanBackground,
  PlanFloor,
  PlanLabel,
  PlanOpening,
  PlanOpeningKind,
  PlanPillar,
  PlanPoint,
  PlanWall,
} from '../types';
import {
  DEFAULT_PILLAR_SIZE,
  DEFAULT_WALL_THICKNESS,
  GRID_STEP,
  OPENING_DEFAULT_WIDTH,
  copyPoints,
  dist,
  duplicateNames,
  floorBounds,
  growOutline,
  normalizeRing,
  openingFrame,
  outsideOutline,
  pointInPolygon,
  polygonArea,
  refitOpening,
  segmentInPolygon,
  wallsAlong,
  type AlongSide,
} from './geometry';

/**
 * Bearbeiten eines Stockwerks (Pläne, Entscheide vom 20.11.2026): Umriss, Flächen, Wände, Säulen, Türen, Fenster und
 * Beschriftungen. Änderungen gelten erst mit «Speichern», «Verwerfen» nimmt alles seit «Bearbeiten» zurück. Der Umriss
 * umschliesst immer alles: Flächen lassen ihn wachsen, alles andere muss in ihm liegen.
 */
export type PlanTool = 'select' | 'outline' | 'area' | 'wall' | 'pillar' | 'door' | 'window' | 'label' | 'measure' | 'scale';
/** «walls»: mehrere Wände auf einmal (Shift+Klick), dann in «ids» */
export type PlanSelectionKind = 'outline' | 'area' | 'wall' | 'walls' | 'pillar' | 'opening' | 'label';
export interface PlanSelection {
  kind: PlanSelectionKind;
  id: string;
  ids?: string[];
}
/** Der Umriss hat keine eigene ID */
export const OUTLINE_ID = 'outline';
/** Plan im Hintergrund beim Bearbeiten; «file»: neues Bild, kommt mit «Speichern» */
export type EditablePlan = PlanBackground & { file?: Blob };
export interface FloorContent {
  outline: PlanPoint[] | null;
  areas: PlanArea[];
  walls: PlanWall[];
  pillars: PlanPillar[];
  openings: PlanOpening[];
  labels: PlanLabel[];
  plan: EditablePlan | null;
}
/** Ebenen beim Ansehen und Drucken; der Umriss ist immer sichtbar */
export interface Layers {
  plan: boolean;
  areas: boolean;
  structure: boolean;
  labels: boolean;
}
export interface Line {
  a: PlanPoint;
  b?: PlanPoint;
}
export type OpeningDraft = Omit<PlanOpening, 'id'>;

/** UUID auch ohne sichere Verbindung (crypto.randomUUID gibt es nur über HTTPS bzw. localhost) */
export function newId(): string {
  const b = crypto.getRandomValues(new Uint8Array(16));
  b[6] = (b[6]! & 0x0f) | 0x40;
  b[8] = (b[8]! & 0x3f) | 0x80;
  const h = [...b].map((x) => x.toString(16).padStart(2, '0')).join('');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

const clone = (c: FloorContent): FloorContent => ({
  outline: c.outline ? copyPoints(c.outline) : null,
  areas: c.areas.map((a) => ({ ...a, points: copyPoints(a.points) })),
  walls: c.walls.map((w) => ({ ...w, a: [w.a[0], w.a[1]], b: [w.b[0], w.b[1]] })),
  pillars: c.pillars.map((p) => ({ ...p })),
  openings: c.openings.map((o) => ({ ...o })),
  labels: c.labels.map((l) => ({ ...l })),
  plan: c.plan ? { ...c.plan } : null,
});
/** Vergleich ohne das Bild selbst */
const fingerprint = (c: FloorContent) =>
  JSON.stringify({ ...c, plan: c.plan ? { ...c.plan, url: undefined, file: !!c.plan.file } : null });

const NEED_OUTLINE = 'Zeichne zuerst den Umriss des Stockwerks oder eine Fläche.';
const AREA_OUTSIDE = 'Die Fläche muss den Umriss berühren oder in ihm liegen. Ziehe sonst zuerst den Umriss grösser.';

export function usePlanEditor() {
  const toast = useToast();
  const state = reactive({
    floor: null as PlanFloor | null,
    draft: null as FloorContent | null,
    tool: 'select' as PlanTool,
    selection: null as PlanSelection | null,
    /** Rechteck (a, b) oder Ecken (points) beim Zeichnen von Umriss, Fläche oder Wänden */
    drawing: null as { a: PlanPoint; b: PlanPoint } | { points: PlanPoint[] } | null,
    /** Wände, die beim laufenden Zeichnen schon entstanden sind (Rücktaste nimmt die letzte weg) */
    chain: [] as string[],
    cursor: null as PlanPoint | null,
    measure: null as Line | null,
    scaleLine: null as Line | null,
    layers: { plan: true, areas: true, structure: true, labels: true } as Layers,
    /** Einstellungen der Werkzeuge; die zuletzt gewählten gelten für das nächste Element */
    options: {
      shape: 'rect' as 'rect' | 'poly',
      areaKind: 'room' as PlanAreaKind,
      wallThickness: DEFAULT_WALL_THICKNESS,
      /** Lage der Wände entlang einer Fläche; die zuletzt gewählte gilt für das nächste Mal */
      alongSide: 'center' as AlongSide,
      pillarShape: 'rect' as 'rect' | 'round',
      pillarSize: DEFAULT_PILLAR_SIZE,
      doorKind: 'door' as Exclude<PlanOpeningKind, 'window'>,
      widths: { ...OPENING_DEFAULT_WIDTH } as Record<PlanOpeningKind, number>,
    },
    /** Tür oder Fenster unter dem Zeiger, bevor man klickt */
    openingPreview: null as OpeningDraft | null,
    /** Umriss beim Ziehen einer Ecke: umschliesst nicht mehr alles */
    outlineInvalid: false,
    /** Raster bei der aktuellen Ansicht (5 cm, nah 1 cm); setzt die Zeichenfläche */
    gridStep: GRID_STEP,
    /** Woran gerade etwas einrastet oder andockt: Ecke bzw. Kanten (Anzeige beim Zeichnen und Ziehen) */
    snapHint: null as { vertex?: PlanPoint; lines: [PlanPoint, PlanPoint][] } | null,
    /** Kurz hervorgehobene Fläche (nach der Suche) */
    flashId: null as string | null,
    saving: false,
    saveError: '',
    /** Fläche löschen: Rückfrage offen */
    confirmDelete: false,
  });

  const editing = computed(() => state.draft !== null);
  const content = computed<FloorContent | null>(() => state.draft ?? state.floor);
  const dirty = computed(() => !!state.floor && !!state.draft && fingerprint(state.draft) !== fingerprint(state.floor));
  const bounds = computed(() => (content.value ? floorBounds(content.value, content.value.plan) : null));
  const pick = <T extends { id: string }>(kind: PlanSelectionKind, list: (c: FloorContent) => T[]) =>
    computed<T | null>(() => (state.selection?.kind === kind && content.value ? (list(content.value).find((x) => x.id === state.selection!.id) ?? null) : null));
  const selectedArea = pick('area', (c) => c.areas);
  const selectedWall = pick('wall', (c) => c.walls);
  /** Mehrere gewählte Wände */
  const selectedWalls = computed(() => {
    const sel = state.selection;
    if (sel?.kind !== 'walls' || !content.value) return [];
    return content.value.walls.filter((w) => sel.ids?.includes(w.id));
  });
  const selectedPillar = pick('pillar', (c) => c.pillars);
  const selectedOpening = pick('opening', (c) => c.openings);
  const selectedLabel = pick('label', (c) => c.labels);
  const outlineSelected = computed(() => state.selection?.kind === 'outline' && !!content.value?.outline);
  /** Was das Speichern verhindert: Räume ohne Namen, doppelte Namen */
  const problems = computed(() => {
    const c = state.draft;
    if (!c) return [];
    const list: string[] = [];
    const unnamed = c.areas.filter((a) => a.kind === 'room' && !a.name.trim()).length;
    if (unnamed) list.push(unnamed === 1 ? 'Ein Raum hat keinen Namen' : `${unnamed} Räume haben keinen Namen`);
    const dups = duplicateNames(c.areas.map((a) => a.name));
    if (dups.length) list.push(`Diese Namen gibt es im Stockwerk doppelt: «${dups.join('», «')}»`);
    return list;
  });

  function resetTools() {
    endChain();
    state.tool = 'select';
    state.drawing = null;
    state.cursor = null;
    state.measure = null;
    state.scaleLine = null;
    state.openingPreview = null;
    state.outlineInvalid = false;
    state.snapHint = null;
    state.confirmDelete = false;
  }

  function show(floor: PlanFloor) {
    if (state.draft?.plan?.file) URL.revokeObjectURL(state.draft.plan.url);
    state.floor = floor;
    state.draft = null;
    state.selection = null;
    state.saveError = '';
    resetTools();
  }

  function startEdit() {
    if (!state.floor) return;
    state.draft = clone(state.floor);
    state.saveError = '';
    resetTools();
  }

  /** Gibt es die Auswahl (noch)? */
  function exists(sel: PlanSelection, c: FloorContent | null): boolean {
    if (!c) return false;
    if (sel.kind === 'outline') return !!c.outline;
    if (sel.kind === 'walls') return !!sel.ids?.every((id) => c.walls.some((w) => w.id === id));
    const list = { area: c.areas, wall: c.walls, pillar: c.pillars, opening: c.openings, label: c.labels }[sel.kind];
    return list.some((x) => x.id === sel.id);
  }

  function discard() {
    if (state.draft?.plan?.file) URL.revokeObjectURL(state.draft.plan.url);
    state.draft = null;
    state.saveError = '';
    if (state.selection && !exists(state.selection, content.value)) state.selection = null;
    resetTools();
  }

  /** Speichern; danach lädt der Aufrufer das Stockwerk neu */
  async function save(): Promise<boolean> {
    const floor = state.floor;
    const draft = state.draft;
    if (!floor || !draft) return false;
    if (problems.value.length) {
      state.saveError = `Speichern geht noch nicht: ${problems.value.join('; ')}.`;
      return false;
    }
    const form = new FormData();
    const plan = draft.plan;
    form.append(
      'content',
      JSON.stringify({
        outline: draft.outline,
        areas: draft.areas.map((a) => ({ id: a.id, kind: a.kind, name: a.name.trim(), description: a.description.trim(), points: a.points })),
        walls: draft.walls,
        pillars: draft.pillars,
        openings: draft.openings,
        labels: draft.labels.map((l) => ({ id: l.id, text: l.text.trim(), x: l.x, y: l.y })),
        plan: plan
          ? { replace: !!plan.file, widthPx: plan.widthPx, heightPx: plan.heightPx, metersPerPx: plan.metersPerPx, x: plan.x, y: plan.y, calibrated: plan.calibrated }
          : null,
        contentUpdatedAt: floor.contentUpdatedAt,
      }),
    );
    if (plan?.file) form.append('plan', plan.file, plan.file.type === 'image/jpeg' ? 'plan.jpg' : 'plan.png');
    state.saving = true;
    state.saveError = '';
    try {
      await api.put(`/plans/floors/${floor.id}/content`, form);
      return true;
    } catch (err) {
      state.saveError = (err as Error).message;
      return false;
    } finally {
      state.saving = false;
    }
  }

  function select(kind: PlanSelectionKind | null, id?: string, ids?: string[]) {
    if (kind === 'walls') {
      // Mehrere Wände; eine einzige ist eine gewöhnliche Auswahl
      const list = [...new Set(ids ?? [])];
      state.selection = list.length > 1 ? { kind: 'walls', id: list[0]!, ids: list } : list.length ? { kind: 'wall', id: list[0]! } : null;
    } else {
      state.selection = kind ? { kind, id: kind === 'outline' ? OUTLINE_ID : (id ?? '') } : null;
      if (state.selection && !state.selection.id) state.selection = null;
    }
    state.confirmDelete = false;
  }

  /** Shift+Klick auf eine Wand: zur Auswahl hinzu oder weg */
  function toggleWall(id: string) {
    const sel = state.selection;
    const ids = sel?.kind === 'walls' ? [...(sel.ids ?? [])] : sel?.kind === 'wall' ? [sel.id] : [];
    const i = ids.indexOf(id);
    if (i >= 0) ids.splice(i, 1);
    else ids.push(id);
    select('walls', undefined, ids);
  }

  /** Wände, Säulen, Türen, Fenster und Beschriftungen gehen erst mit einem Umriss */
  function outlineOrHint(): PlanPoint[] | null {
    const outline = state.draft?.outline ?? null;
    if (!outline) toast.error(NEED_OUTLINE);
    return outline;
  }

  /* ---------- Umriss ---------- */

  function setOutline(points: PlanPoint[]) {
    const d = state.draft;
    if (!d) return;
    const outline = normalizeRing(points);
    const outside = outsideOutline(outline, d);
    if (outside.length) {
      toast.error(`Der Umriss muss alles im Stockwerk umschliessen, ausserhalb läge: ${outside.slice(0, 4).join(', ')}`);
      return;
    }
    d.outline = outline;
    state.tool = 'select';
    state.drawing = null;
    select('outline');
  }

  /** Nach dem Ziehen einer Ecke: umschliesst er nicht mehr alles, springt er zurück */
  function commitOutline(before: PlanPoint[]): boolean {
    const d = state.draft;
    state.outlineInvalid = false;
    if (!d?.outline) return false;
    const outside = polygonArea(d.outline) < 0.01 ? ['alles'] : outsideOutline(d.outline, d);
    if (outside.length) {
      d.outline = before;
      toast.error(`Der Umriss muss alles im Stockwerk umschliessen, ausserhalb läge: ${outside.slice(0, 4).join(', ')}`);
      return false;
    }
    d.outline = normalizeRing(d.outline);
    return true;
  }

  /** Beim Ziehen: umschliesst der Umriss noch alles? */
  function checkOutline() {
    const d = state.draft;
    state.outlineInvalid = !!d?.outline && outsideOutline(d.outline, d).length > 0;
  }

  /* ---------- Flächen ---------- */

  function addArea(points: PlanPoint[]) {
    const d = state.draft;
    if (!d) return;
    if (!d.outline) d.outline = normalizeRing(points);
    else {
      const grown = growOutline(d.outline, points);
      if (!grown) {
        toast.error(AREA_OUTSIDE);
        state.drawing = null;
        return;
      }
      d.outline = grown;
    }
    const area: PlanArea = { id: newId(), kind: state.options.areaKind, name: '', description: '', points };
    d.areas.push(area);
    state.tool = 'select';
    state.drawing = null;
    select('area', area.id);
  }

  /** Nach dem Verschieben einer Fläche oder einer Ecke: der Umriss wächst mit, ganz ausserhalb springt sie zurück */
  function commitArea(area: PlanArea, before: PlanPoint[]): boolean {
    const d = state.draft;
    if (!d?.outline) return false;
    const grown = growOutline(d.outline, area.points);
    if (!grown) {
      area.points = before;
      toast.error(AREA_OUTSIDE);
      return false;
    }
    d.outline = grown;
    return true;
  }

  /* ---------- Wände ---------- */

  /** Eine Wand von a nach b (ein gerades Stück), gehört zum laufenden Zeichnen */
  function addWallPiece(a: PlanPoint, b: PlanPoint): boolean {
    const d = state.draft;
    const outline = outlineOrHint();
    if (!d || !outline) return false;
    if (!segmentInPolygon(a, b, outline)) {
      toast.error('Die Wand muss im Umriss liegen.');
      return false;
    }
    const wall: PlanWall = { id: newId(), a: [a[0], a[1]], b: [b[0], b[1]], thickness: state.options.wallThickness, align: 'center' };
    d.walls.push(wall);
    state.chain.push(wall.id);
    return true;
  }

  /** Letzte Wand des laufenden Zeichnens zurücknehmen (Rücktaste) */
  function undoWallPiece() {
    const d = state.draft;
    const id = state.chain.pop();
    if (!d || !id) return;
    d.walls = d.walls.filter((w) => w.id !== id);
    d.openings = d.openings.filter((o) => o.wallId !== id);
  }

  /** Zeichnen der Wände beenden: die neuen Wände sind gewählt (für die Dicke) */
  function endChain() {
    const ids = state.chain.filter((id) => state.draft?.walls.some((w) => w.id === id));
    state.chain = [];
    if (state.tool === 'wall') {
      state.drawing = null;
      state.cursor = null;
    }
    if (ids.length) select('walls', undefined, ids);
  }

  /**
   * Wände auf den Kanten einer Fläche oder des Umrisses: eine je Kante, Kanten mit Wand fallen weg. Beim Umriss bündig
   * nach innen (die Aussenkante ist der Umriss), bei Flächen nach Wahl mittig, innen oder aussen bündig.
   */
  function addWallsAlong(points: PlanPoint[], side: AlongSide) {
    const d = state.draft;
    if (!d || !outlineOrHint()) return;
    const pieces = wallsAlong(points, d.walls, side);
    if (!pieces.length) {
      toast.error('Auf allen Kanten liegt schon eine Wand.');
      return;
    }
    const thickness = state.options.wallThickness;
    for (const p of pieces) d.walls.push({ id: newId(), a: p.a, b: p.b, thickness, align: p.align });
    toast.success(pieces.length === 1 ? 'Wand angelegt' : `${pieces.length} Wände angelegt`);
  }

  /** Dicke für mehrere Wände; die zuletzt gewählte Dicke gilt für die nächste Wand */
  function setWallThickness(walls: PlanWall[], meters: number) {
    for (const w of walls) w.thickness = meters;
    state.options.wallThickness = meters;
  }

  /** Stand von Wänden vor dem Ziehen, mit ihren Türen und Fenstern */
  function wallsSnapshot(ids: string[]) {
    const d = state.draft;
    return {
      walls: (d?.walls ?? []).filter((w) => ids.includes(w.id)).map((w) => ({ ...w, a: [w.a[0], w.a[1]] as PlanPoint, b: [w.b[0], w.b[1]] as PlanPoint })),
      openings: (d?.openings ?? []).filter((o) => ids.includes(o.wallId)).map((o) => ({ ...o })),
    };
  }
  type WallsSnapshot = ReturnType<typeof wallsSnapshot>;

  /** Türen und Fenster folgen ihrer Wand: vom Stand vor dem Ziehen auf die neue Lage; passt eine nicht mehr, fällt sie weg */
  function refitOpenings(snapshot: WallsSnapshot) {
    const d = state.draft;
    if (!d) return;
    const moved = new Map<string, PlanOpening | null>();
    for (const o of snapshot.openings) {
      const f = openingFrame(o, snapshot.walls);
      const wall = d.walls.find((w) => w.id === o.wallId);
      // Mitte auf der Linie der Wand (nicht in der Mitte der Dicke)
      const old = snapshot.walls.find((w) => w.id === o.wallId)!;
      const center: PlanPoint | null = f ? [old.a[0] + f.u[0] * o.offset, old.a[1] + f.u[1] * o.offset] : null;
      moved.set(o.id, f && wall && center ? refitOpening(o, wall, center) : null);
    }
    d.openings = [...d.openings.filter((o) => !moved.has(o.id)), ...[...moved.values()].filter((o): o is PlanOpening => !!o)];
  }

  /** Nach dem Ziehen von Wänden oder Enden: ausserhalb des Umrisses springen alle zurück */
  function commitWalls(snapshot: WallsSnapshot): boolean {
    const d = state.draft;
    if (!d?.outline) return false;
    const ids = snapshot.walls.map((w) => w.id);
    const changed = d.walls.filter((w) => ids.includes(w.id));
    if (changed.every((w) => segmentInPolygon(w.a, w.b, d.outline!))) {
      const lost = snapshot.openings.filter((o) => !d.openings.some((x) => x.id === o.id)).length;
      if (lost) toast.error(lost === 1 ? 'Eine Tür bzw. ein Fenster passte nicht mehr in die Wand und fiel weg.' : `${lost} Türen bzw. Fenster passten nicht mehr in die Wand und fielen weg.`);
      return true;
    }
    for (const w of changed) {
      const before = snapshot.walls.find((x) => x.id === w.id)!;
      w.a = before.a;
      w.b = before.b;
    }
    d.openings = [...d.openings.filter((o) => !ids.includes(o.wallId)), ...snapshot.openings];
    toast.error('Die Wand muss im Umriss liegen.');
    return false;
  }

  /* ---------- Säulen, Türen, Fenster, Beschriftungen ---------- */

  function addPillar(p: PlanPoint) {
    const d = state.draft;
    const outline = outlineOrHint();
    if (!d || !outline) return;
    // Raster und Andocken rechnet die Zeichenfläche
    const at: PlanPoint = [p[0], p[1]];
    if (!pointInPolygon(at, outline)) {
      toast.error('Die Säule muss im Umriss liegen.');
      return;
    }
    const size = state.options.pillarSize;
    const pillar: PlanPillar = { id: newId(), shape: state.options.pillarShape, x: at[0], y: at[1], width: size, depth: size, rotation: 0 };
    d.pillars.push(pillar);
    select('pillar', pillar.id);
  }

  function addOpening() {
    const d = state.draft;
    const preview = state.openingPreview;
    if (!d || !preview) return;
    const opening: PlanOpening = { id: newId(), ...preview };
    d.openings.push(opening);
    state.openingPreview = null;
    state.tool = 'select';
    select('opening', opening.id);
  }

  function addLabel(p: PlanPoint) {
    const d = state.draft;
    const outline = outlineOrHint();
    if (!d || !outline) return;
    const at: PlanPoint = [p[0], p[1]];
    if (!pointInPolygon(at, outline)) {
      toast.error('Die Beschriftung muss im Umriss liegen.');
      return;
    }
    const label: PlanLabel = { id: newId(), text: 'Beschriftung', x: at[0], y: at[1] };
    d.labels.push(label);
    state.tool = 'select';
    select('label', label.id);
  }

  /** Nach dem Ziehen einer Säule oder Beschriftung: ausserhalb des Umrisses springt sie zurück */
  function commitPoint(item: { x: number; y: number }, before: PlanPoint, what: string): boolean {
    const outline = state.draft?.outline;
    if (!outline || pointInPolygon([item.x, item.y], outline)) return true;
    item.x = before[0];
    item.y = before[1];
    toast.error(`${what} muss im Umriss liegen.`);
    return false;
  }

  /* ---------- Löschen ---------- */

  /** Kann der Umriss weg? Nur, wenn sonst nichts im Stockwerk ist */
  const outlineDeletable = computed(() => {
    const c = content.value;
    return !!c && !c.areas.length && !c.walls.length && !c.pillars.length && !c.labels.length;
  });

  function deleteSelected() {
    const d = state.draft;
    const sel = state.selection;
    if (!d || !sel) return;
    switch (sel.kind) {
      case 'outline':
        if (!outlineDeletable.value) {
          toast.error('Der Umriss lässt sich nur löschen, wenn sonst nichts im Stockwerk ist.');
          return;
        }
        d.outline = null;
        break;
      case 'area':
        d.areas = d.areas.filter((a) => a.id !== sel.id);
        break;
      case 'wall':
      case 'walls': {
        const ids = sel.kind === 'walls' ? (sel.ids ?? []) : [sel.id];
        d.walls = d.walls.filter((w) => !ids.includes(w.id));
        d.openings = d.openings.filter((o) => !ids.includes(o.wallId));
        break;
      }
      case 'pillar':
        d.pillars = d.pillars.filter((p) => p.id !== sel.id);
        break;
      case 'opening':
        d.openings = d.openings.filter((o) => o.id !== sel.id);
        break;
      case 'label':
        d.labels = d.labels.filter((l) => l.id !== sel.id);
    }
    select(null);
  }

  /* ---------- Plan im Hintergrund ---------- */

  /** Neues Bild als Plan; erster Massstab: so breit wie das Stockwerk bisher, danach «Massstab setzen» */
  function setPlanImage(file: Blob, widthPx: number, heightPx: number) {
    const d = state.draft;
    if (!d) return;
    if (d.plan?.file) URL.revokeObjectURL(d.plan.url);
    const width = d.outline ? Math.max(bounds.value?.w ?? 30, 10) : 30;
    d.plan = { url: URL.createObjectURL(file), widthPx, heightPx, metersPerPx: width / widthPx, x: 0, y: 0, calibrated: false, file };
    state.layers.plan = true;
    resetTools();
    state.tool = 'scale';
  }

  function removePlan() {
    const d = state.draft;
    if (!d) return;
    if (d.plan?.file) URL.revokeObjectURL(d.plan.url);
    d.plan = null;
    if (state.tool === 'scale') resetTools();
  }

  /** Massstab: Die markierte Strecke ist in Wirklichkeit so lang; der Plan wird um seine linke obere Ecke skaliert */
  function applyScale(realMeters: number): boolean {
    const plan = state.draft?.plan;
    const line = state.scaleLine;
    if (!plan || !line?.b || !(realMeters > 0)) return false;
    const measured = dist(line.a, line.b);
    if (!(measured > 0)) return false;
    plan.metersPerPx *= realMeters / measured;
    plan.calibrated = true;
    resetTools();
    return true;
  }

  return {
    state,
    editing,
    content,
    dirty,
    bounds,
    selectedArea,
    selectedWall,
    selectedWalls,
    selectedPillar,
    selectedOpening,
    selectedLabel,
    outlineSelected,
    outlineDeletable,
    problems,
    resetTools,
    show,
    startEdit,
    discard,
    save,
    select,
    toggleWall,
    setOutline,
    commitOutline,
    checkOutline,
    addArea,
    commitArea,
    addWallPiece,
    undoWallPiece,
    endChain,
    addWallsAlong,
    setWallThickness,
    wallsSnapshot,
    refitOpenings,
    commitWalls,
    addPillar,
    addOpening,
    addLabel,
    commitPoint,
    deleteSelected,
    setPlanImage,
    removePlan,
    applyScale,
  };
}
export type PlanEditor = ReturnType<typeof usePlanEditor>;
