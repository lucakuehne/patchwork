import { computed, reactive } from 'vue';
import { api } from '../api';
import type { PlanBackground, PlanFloor, PlanLabel, PlanPoint, PlanRoom } from '../types';
import { dist, duplicateNames, floorBounds, snap } from './geometry';

/**
 * Bearbeiten eines Stockwerks (Pläne, Entscheid vom 20.11.2026): Änderungen gelten erst mit «Speichern», «Verwerfen»
 * nimmt alles seit «Bearbeiten» zurück. Standorte, Gebäude und Stockwerke selbst ändern sich sofort (Baum).
 */
export type PlanTool = 'select' | 'rect' | 'poly' | 'label' | 'measure' | 'scale';
export interface PlanSelection {
  kind: 'room' | 'label';
  id: string;
}
/** Plan im Hintergrund beim Bearbeiten; «file»: neues Bild, kommt mit «Speichern» */
export type EditablePlan = PlanBackground & { file?: Blob };
export interface FloorContent {
  rooms: PlanRoom[];
  labels: PlanLabel[];
  plan: EditablePlan | null;
}
export interface Line {
  a: PlanPoint;
  b?: PlanPoint;
}

/** UUID auch ohne sichere Verbindung (crypto.randomUUID gibt es nur über HTTPS bzw. localhost) */
export function newId(): string {
  const b = crypto.getRandomValues(new Uint8Array(16));
  b[6] = (b[6]! & 0x0f) | 0x40;
  b[8] = (b[8]! & 0x3f) | 0x80;
  const h = [...b].map((x) => x.toString(16).padStart(2, '0')).join('');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

const clone = (c: FloorContent): FloorContent => ({
  rooms: c.rooms.map((r) => ({ ...r, points: r.points.map((p): PlanPoint => [p[0], p[1]]) })),
  labels: c.labels.map((l) => ({ ...l })),
  plan: c.plan ? { ...c.plan } : null,
});
/** Vergleich ohne das Bild selbst */
const fingerprint = (c: FloorContent) =>
  JSON.stringify({ rooms: c.rooms, labels: c.labels, plan: c.plan ? { ...c.plan, url: undefined, file: !!c.plan.file } : null });

export function usePlanEditor() {
  const state = reactive({
    floor: null as PlanFloor | null,
    draft: null as FloorContent | null,
    tool: 'select' as PlanTool,
    selection: null as PlanSelection | null,
    /** Rechteck (a, b) oder Vieleck (points) beim Zeichnen */
    drawing: null as { a: PlanPoint; b: PlanPoint } | { points: PlanPoint[] } | null,
    cursor: null as PlanPoint | null,
    measure: null as Line | null,
    scaleLine: null as Line | null,
    showPlan: true,
    /** Kurz hervorgehobener Raum (nach der Suche) */
    flashId: null as string | null,
    saving: false,
    saveError: '',
    /** Raum löschen: Rückfrage offen */
    confirmDelete: false,
  });

  const editing = computed(() => state.draft !== null);
  const content = computed<FloorContent | null>(() => state.draft ?? state.floor);
  const dirty = computed(() => !!state.floor && !!state.draft && fingerprint(state.draft) !== fingerprint(state.floor));
  const bounds = computed(() => (content.value ? floorBounds(content.value.rooms, content.value.labels, content.value.plan) : null));
  const selectedRoom = computed(() =>
    state.selection?.kind === 'room' ? (content.value?.rooms.find((r) => r.id === state.selection!.id) ?? null) : null,
  );
  const selectedLabel = computed(() =>
    state.selection?.kind === 'label' ? (content.value?.labels.find((l) => l.id === state.selection!.id) ?? null) : null,
  );
  /** Was das Speichern verhindert: Räume ohne Namen, doppelte Namen */
  const problems = computed(() => {
    const c = state.draft;
    if (!c) return [];
    const list: string[] = [];
    const unnamed = c.rooms.filter((r) => !r.name.trim()).length;
    if (unnamed) list.push(unnamed === 1 ? 'Ein Raum hat keinen Namen' : `${unnamed} Räume haben keinen Namen`);
    const dups = duplicateNames(c.rooms.map((r) => r.name));
    if (dups.length) list.push(`Diese Namen gibt es im Stockwerk doppelt: «${dups.join('», «')}»`);
    return list;
  });

  function resetTools() {
    state.tool = 'select';
    state.drawing = null;
    state.cursor = null;
    state.measure = null;
    state.scaleLine = null;
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

  function discard() {
    if (state.draft?.plan?.file) URL.revokeObjectURL(state.draft.plan.url);
    state.draft = null;
    state.saveError = '';
    if (state.selection && !content.value?.[state.selection.kind === 'room' ? 'rooms' : 'labels'].some((x) => x.id === state.selection!.id)) {
      state.selection = null;
    }
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
        rooms: draft.rooms.map((r) => ({ id: r.id, name: r.name.trim(), description: r.description.trim(), points: r.points })),
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

  function select(kind: PlanSelection['kind'] | null, id?: string) {
    state.selection = kind && id ? { kind, id } : null;
    state.confirmDelete = false;
  }

  function addRoom(points: PlanPoint[]) {
    if (!state.draft) return;
    const room: PlanRoom = { id: newId(), name: '', description: '', points };
    state.draft.rooms.push(room);
    state.tool = 'select';
    state.drawing = null;
    select('room', room.id);
  }

  function addLabel(p: PlanPoint) {
    if (!state.draft) return;
    const label: PlanLabel = { id: newId(), text: 'Beschriftung', x: snap(p[0]), y: snap(p[1]) };
    state.draft.labels.push(label);
    state.tool = 'select';
    select('label', label.id);
  }

  function deleteSelected() {
    const d = state.draft;
    const sel = state.selection;
    if (!d || !sel) return;
    if (sel.kind === 'room') d.rooms = d.rooms.filter((r) => r.id !== sel.id);
    else d.labels = d.labels.filter((l) => l.id !== sel.id);
    select(null);
  }

  /** Neues Bild als Plan; erster Massstab: so breit wie das Stockwerk bisher, danach «Massstab setzen» */
  function setPlanImage(file: Blob, widthPx: number, heightPx: number) {
    const d = state.draft;
    if (!d) return;
    if (d.plan?.file) URL.revokeObjectURL(d.plan.url);
    const width = d.rooms.length ? Math.max(bounds.value?.w ?? 30, 10) : 30;
    d.plan = { url: URL.createObjectURL(file), widthPx, heightPx, metersPerPx: width / widthPx, x: 0, y: 0, calibrated: false, file };
    state.showPlan = true;
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
    selectedRoom,
    selectedLabel,
    problems,
    resetTools,
    show,
    startEdit,
    discard,
    save,
    select,
    addRoom,
    addLabel,
    deleteSelected,
    setPlanImage,
    removePlan,
    applyScale,
  };
}
export type PlanEditor = ReturnType<typeof usePlanEditor>;
