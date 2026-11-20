<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { onBeforeRouteLeave, useRoute, useRouter } from 'vue-router';
import { api, errorMessage } from '../api';
import ModalDialog from '../components/ModalDialog.vue';
import PlanCanvas from '../components/plans/PlanCanvas.vue';
import PlanPdfDialog from '../components/plans/PlanPdfDialog.vue';
import PlanPrint from '../components/plans/PlanPrint.vue';
import PlanTree from '../components/plans/PlanTree.vue';
import { usePlanEditor, type PlanSelection, type PlanTool } from '../plans/editor';
import {
  AREA_KIND_LABELS,
  AREA_KIND_PLURALS,
  AREA_KINDS,
  OPENING_LABELS,
  areaTitle,
  bbox,
  dist,
  duplicateNames,
  formatNumber,
  isRect,
  openingFrame,
  polygonArea,
  polylineLength,
} from '../plans/geometry';
import { imageSize, openPdf, type PdfPages } from '../plans/pdf';
import { useSession } from '../stores/session';
import { useToast } from '../stores/toast';
import type { PlanFloor, PlanOpeningKind, PlanSearchHit, PlanTreeSite } from '../types';

/**
 * Pläne (Entscheide vom 20.11.2026): Standorte, Gebäude und Stockwerke; je Stockwerk Umriss, Flächen (Räume, Gänge,
 * Treppenhäuser …), Bauteile (Wände, Säulen, Türen, Fenster) und Beschriftungen, massstabsgetreu. Ansehen mit dem Recht
 * «Pläne ansehen», ändern mit «Pläne bearbeiten». Adresse: /plans?floor=<id>&area=<id>
 */
const session = useSession();
const toast = useToast();
const route = useRoute();
const router = useRouter();
const editor = usePlanEditor();
const state = editor.state;
const canEdit = computed(() => session.can('plansEdit'));

const tree = ref<PlanTreeSite[]>([]);
const loading = ref(true);
const loadError = ref('');
const canvas = ref<InstanceType<typeof PlanCanvas> | null>(null);
const content = computed(() => editor.content.value);
const floor = computed(() => state.floor);
const editing = computed(() => editor.editing.value);
const path = computed(() => (floor.value ? `${floor.value.site.name} · ${floor.value.building.name} · ${floor.value.name}` : ''));

async function loadTree() {
  tree.value = await api.get<PlanTreeSite[]>('/plans');
}
const firstFloorId = () => tree.value.flatMap((s) => s.buildings.flatMap((b) => b.floors))[0]?.id ?? null;
const floorExists = (id: string) => tree.value.some((s) => s.buildings.some((b) => b.floors.some((f) => f.id === id)));

async function openFloor(id: string | null, areaId?: string) {
  if (!id) {
    state.floor = null;
    editor.discard();
    void router.replace({ query: {} });
    return;
  }
  try {
    editor.show(await api.get<PlanFloor>(`/plans/floors/${id}`));
    if (route.query.floor !== id || route.query.room || (route.query.area && route.query.area !== areaId)) {
      void router.replace({ query: { floor: id, ...(areaId ? { area: areaId } : {}) } });
    }
    if (areaId) {
      await nextTick();
      canvas.value?.focusArea(areaId);
      editor.select('area', areaId);
    }
  } catch (err) {
    toast.error(err);
  }
}

onMounted(async () => {
  try {
    await loadTree();
    const wanted = typeof route.query.floor === 'string' && floorExists(route.query.floor) ? route.query.floor : firstFloorId();
    // Frühere Adressen nannten die Fläche «room»
    const area = route.query.area ?? route.query.room;
    await openFloor(wanted, typeof area === 'string' ? area : undefined);
  } catch (err) {
    loadError.value = errorMessage(err);
  } finally {
    loading.value = false;
  }
});

/* ---------- Ungespeicherte Änderungen ---------- */
const leaveDialog = ref<{ resolve: (go: boolean) => void } | null>(null);
/** Vor dem Wechsel: ohne Änderungen still beenden, sonst fragen (Speichern, Verwerfen, Zurück) */
function askLeave(): Promise<boolean> {
  if (!editor.dirty.value) {
    if (editing.value) editor.discard();
    return Promise.resolve(true);
  }
  return new Promise((resolve) => (leaveDialog.value = { resolve }));
}
function closeLeave(go: boolean) {
  leaveDialog.value?.resolve(go);
  leaveDialog.value = null;
}
async function leaveWithSave() {
  closeLeave(await saveFloor());
}
function leaveWithDiscard() {
  editor.discard();
  closeLeave(true);
}
onBeforeRouteLeave(() => askLeave());
function onBeforeUnload(e: BeforeUnloadEvent) {
  if (editor.dirty.value) e.preventDefault();
}
onMounted(() => window.addEventListener('beforeunload', onBeforeUnload));
onBeforeUnmount(() => window.removeEventListener('beforeunload', onBeforeUnload));

/* ---------- Baum ---------- */
async function selectFloor(id: string) {
  if (id === floor.value?.id) return;
  if (await askLeave()) await openFloor(id);
}
async function treeChanged(change: { open?: string; removed?: string[] }) {
  await loadTree();
  const current = floor.value?.id ?? null;
  if (current && change.removed?.includes(current)) {
    editor.discard();
    await openFloor(firstFloorId());
    return;
  }
  if (change.open) {
    if (await askLeave()) await openFloor(change.open);
    return;
  }
  // Umbenannt: Namen im Weg nachführen, ohne den Inhalt beim Bearbeiten neu zu laden
  if (current && !editing.value) await openFloor(current);
  else if (current && floor.value) {
    for (const s of tree.value)
      for (const b of s.buildings)
        for (const f of b.floors)
          if (f.id === current) {
            floor.value.name = f.name;
            floor.value.building.name = b.name;
            floor.value.site.name = s.name;
          }
  }
  if (!current) await openFloor(firstFloorId());
}

/* ---------- Suche ---------- */
const search = ref('');
const hits = ref<PlanSearchHit[]>([]);
let searchTimer: number | undefined;
watch(search, (q) => {
  window.clearTimeout(searchTimer);
  if (!q.trim()) {
    hits.value = [];
    return;
  }
  searchTimer = window.setTimeout(async () => {
    try {
      hits.value = await api.get<PlanSearchHit[]>(`/plans/search?q=${encodeURIComponent(q.trim())}`);
    } catch (err) {
      toast.error(err);
    }
  }, 200);
});
async function goToArea(hit: PlanSearchHit) {
  if (!(await askLeave())) return;
  if (floor.value?.id !== hit.floorId) await openFloor(hit.floorId, hit.id);
  else {
    canvas.value?.focusArea(hit.id);
    editor.select('area', hit.id);
  }
}
function highlight(text: string) {
  const q = search.value.trim().toLowerCase();
  const i = text.toLowerCase().indexOf(q);
  return i < 0 ? [text, '', ''] : [text.slice(0, i), text.slice(i, i + q.length), text.slice(i + q.length)];
}

/* ---------- Werkzeuge ---------- */
const TOOL_LABELS: Record<PlanTool, string> = {
  select: 'Auswählen',
  outline: 'Umriss',
  area: 'Fläche',
  wall: 'Wand',
  pillar: 'Säule',
  door: 'Tür',
  window: 'Fenster',
  label: 'Beschriftung',
  measure: 'Messen',
  scale: 'Massstab setzen',
};
const tools = computed<PlanTool[]>(() =>
  editing.value ? ['select', 'outline', 'area', 'wall', 'pillar', 'door', 'window', 'label', 'measure'] : ['select', 'measure'],
);
/** Warum ein Werkzeug (noch) nicht geht */
function toolBlocked(t: PlanTool): string | null {
  const c = content.value;
  if (!c || !editing.value) return null;
  if (['wall', 'pillar', 'label', 'door', 'window'].includes(t) && !c.outline) return 'Zuerst den Umriss oder eine Fläche zeichnen';
  if ((t === 'door' || t === 'window') && !c.walls.length) return 'Zuerst eine Wand zeichnen';
  return null;
}
const shapeWord = computed(() => (state.options.shape === 'rect' ? 'rect' : 'poly'));
const HINTS: Record<'view' | 'edit', Partial<Record<PlanTool, string>>> = {
  view: {
    select: 'Fläche anklicken für ihre Angaben. Ziehen verschiebt den Plan, das Mausrad vergrössert.',
    measure: 'Messen: Anfang und Ende einer Strecke anklicken. Ein weiterer Klick beginnt neu, Esc löscht.',
  },
  edit: {
    select:
      'Anklicken wählt aus; Flächen, Wände, Säulen, Türen und Beschriftungen lassen sich ziehen. Bei der gewählten Form: Ecken ziehen, Punkt in der Kantenmitte ziehen fügt eine Ecke ein, Doppelklick entfernt sie. Entf löscht.',
    wall: 'Wand: Ecken nacheinander anklicken. Doppelklick oder Eingabetaste beendet, Klick auf die erste Ecke schliesst sie, Rücktaste nimmt die letzte Ecke weg.',
    pillar: 'Säule: an die Stelle klicken. Form und Grösse oben, danach rechts änderbar.',
    door: 'Tür: auf eine Wand klicken. Anschlag und Aufschlag stellst du danach rechts ein.',
    window: 'Fenster: auf eine Wand klicken.',
    label: 'Beschriftung: an die Stelle klicken, z.B. für Notausgang oder Haupteingang.',
    measure: 'Messen: Anfang und Ende einer Strecke anklicken.',
    scale: 'Massstab setzen: Anfang und Ende einer Strecke anklicken, deren Länge du kennst (z.B. eine Aussenwand), dann die echte Länge eingeben.',
  },
};
const DRAW_HINTS = {
  rect: 'an einer Ecke drücken und zur gegenüberliegenden ziehen. Raster 10 cm, rastet an Ecken ein.',
  poly: 'Ecken nacheinander anklicken, zum Abschliessen die erste Ecke anklicken oder doppelklicken. Rücktaste nimmt die letzte Ecke weg.',
};
const hint = computed(() => {
  if (editing.value && state.tool === 'outline') return `Umriss: ${DRAW_HINTS[shapeWord.value]} Er umschliesst danach alles im Stockwerk.`;
  if (editing.value && state.tool === 'area') {
    return `Fläche: ${DRAW_HINTS[shapeWord.value]} ${content.value?.outline ? 'Geht sie über den Umriss hinaus, wächst er mit.' : 'Die erste Fläche wird zum Umriss.'}`;
  }
  return HINTS[editing.value ? 'edit' : 'view'][state.tool] ?? '';
});
function setTool(t: PlanTool) {
  editor.resetTools();
  // Gibt es den Umriss schon, wählt «Umriss» ihn zum Bearbeiten
  if (t === 'outline' && content.value?.outline) {
    editor.select('outline');
    return;
  }
  state.tool = t;
}
function setShape(shape: 'rect' | 'poly') {
  state.options.shape = shape;
  state.drawing = null;
}

/** Eingabe in cm für einen Wert in Metern, nur innerhalb der Grenzen */
function cmField(get: () => number | undefined, set: (meters: number) => void, min: number, max: number) {
  return computed({
    get: () => Math.round((get() ?? 0) * 100),
    set: (value: number | string) => {
      const n = Number(value);
      if (Number.isFinite(n) && n >= min && n <= max) set(n / 100);
    },
  });
}
const wallCm = cmField(() => state.options.wallThickness, (m) => (state.options.wallThickness = m), 2, 200);
const pillarCm = cmField(() => state.options.pillarSize, (m) => (state.options.pillarSize = m), 5, 500);
const doorWidthCm = cmField(() => state.options.widths[state.options.doorKind], (m) => (state.options.widths[state.options.doorKind] = m), 20, 1000);
const windowWidthCm = cmField(() => state.options.widths.window, (m) => (state.options.widths.window = m), 20, 1000);
const DOOR_KINDS: { value: Exclude<PlanOpeningKind, 'window'>; label: string }[] = [
  { value: 'door', label: 'Tür' },
  { value: 'double', label: 'Zweiflüglig' },
  { value: 'opening', label: 'Öffnung' },
];

/* ---------- Bearbeiten ---------- */
function stillThere(sel: PlanSelection | null): boolean {
  const c = editor.content.value;
  if (!sel || !c) return false;
  if (sel.kind === 'outline') return !!c.outline;
  return ({ area: c.areas, wall: c.walls, pillar: c.pillars, opening: c.openings, label: c.labels }[sel.kind] as { id: string }[]).some((x) => x.id === sel.id);
}
async function saveFloor(): Promise<boolean> {
  const id = floor.value?.id;
  const selection = state.selection;
  if (!id || !(await editor.save())) return false;
  try {
    editor.show(await api.get<PlanFloor>(`/plans/floors/${id}`));
    if (stillThere(selection)) state.selection = selection;
    await loadTree();
  } catch (err) {
    toast.error(err);
  }
  toast.success('Gespeichert');
  return true;
}
function discardEdit() {
  const changed = editor.dirty.value;
  editor.discard();
  if (changed) toast.success('Änderungen verworfen');
}

/* Plan hochladen: Bild direkt, PDF über die gewählte Seite */
const MAX_BYTES = 20 * 1024 * 1024;
const pdfChoice = ref<{ pdf: PdfPages; name: string } | null>(null);
const converting = ref(false);
async function onPlanFile(e: Event) {
  const input = e.target as HTMLInputElement;
  const file = input.files?.[0];
  input.value = '';
  if (!file) return;
  try {
    if (file.type === 'application/pdf' || /\.pdf$/i.test(file.name)) {
      converting.value = true;
      const pdf = await openPdf(file);
      if (pdf.count === 1) await usePdfPage(pdf, 1);
      else pdfChoice.value = { pdf, name: file.name };
    } else {
      if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type)) throw new Error('Als Plan gehen PNG, JPEG, WebP und PDF.');
      if (file.size > MAX_BYTES) throw new Error('Das Bild ist zu gross (höchstens 20 MB).');
      const { width, height } = await imageSize(file);
      editor.setPlanImage(file, width, height);
    }
  } catch (err) {
    toast.error(err);
  } finally {
    converting.value = false;
  }
}
async function usePdfPage(pdf: PdfPages, page: number) {
  converting.value = true;
  try {
    const { blob, width, height } = await pdf.render(page);
    if (blob.size > MAX_BYTES) throw new Error('Die Seite ergibt ein zu grosses Bild (höchstens 20 MB).');
    editor.setPlanImage(blob, width, height);
  } catch (err) {
    toast.error(err);
  } finally {
    pdf.close();
    pdfChoice.value = null;
    converting.value = false;
  }
}

/* Massstab setzen: echte Länge der markierten Strecke */
const realLength = ref('');
const measuredLength = computed(() => (state.scaleLine?.b ? dist(state.scaleLine.a, state.scaleLine.b) : null));
watch(measuredLength, (m) => {
  if (m !== null) realLength.value = formatNumber(m, 2);
});
function applyScale() {
  const meters = Number(realLength.value.replace(',', '.'));
  if (!(meters > 0)) {
    toast.error('Bitte die Länge in Metern angeben, z.B. 12,5.');
    return;
  }
  if (editor.applyScale(meters)) toast.success(`Massstab gesetzt: ${formatNumber(meters, 2)} m`);
}

/* ---------- Angaben ---------- */
const area = computed(() => editor.selectedArea.value);
const areaFacts = computed(() => {
  const a = area.value;
  if (!a) return null;
  const b = bbox(a.points);
  return { area: formatNumber(polygonArea(a.points)), size: isRect(a.points) ? `${formatNumber(b.w)} × ${formatNumber(b.h)} m` : null };
});
const nameDuplicate = computed(() => {
  const a = area.value;
  if (!a || !content.value || !a.name.trim()) return false;
  return duplicateNames(content.value.areas.map((x) => x.name)).some((n) => n.toLowerCase() === a.name.trim().toLowerCase());
});
/** Liste: Flächen mit Namen nach Namen, danach die ohne Namen nach Art */
const sortedAreas = computed(() =>
  [...(content.value?.areas ?? [])].sort(
    (a, b) =>
      Number(!a.name.trim()) - Number(!b.name.trim()) ||
      areaTitle(a).localeCompare(areaTitle(b), 'de', { numeric: true }) ||
      polygonArea(b.points) - polygonArea(a.points),
  ),
);
const kindSummary = computed(() =>
  AREA_KINDS.map((kind) => {
    const list = (content.value?.areas ?? []).filter((a) => a.kind === kind);
    return { kind, count: list.length, area: list.reduce((s, a) => s + polygonArea(a.points), 0) };
  }).filter((k) => k.count),
);
const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;
const structureSummary = computed(() => {
  const c = content.value;
  if (!c) return '';
  const doors = c.openings.filter((o) => o.kind === 'door' || o.kind === 'double').length;
  const gaps = c.openings.filter((o) => o.kind === 'opening').length;
  const windows = c.openings.filter((o) => o.kind === 'window').length;
  const parts = [
    c.walls.length ? plural(c.walls.length, 'Wand', 'Wände') : '',
    c.pillars.length ? plural(c.pillars.length, 'Säule', 'Säulen') : '',
    doors ? plural(doors, 'Tür', 'Türen') : '',
    gaps ? plural(gaps, 'Öffnung', 'Öffnungen') : '',
    windows ? plural(windows, 'Fenster', 'Fenster') : '',
  ].filter(Boolean);
  return parts.join(', ') || 'keine';
});
function pickArea(id: string) {
  editor.select('area', id);
  canvas.value?.focusArea(id);
}
async function focusName() {
  await nextTick();
  const input = document.getElementById('plan-area-name') as HTMLInputElement | null;
  input?.focus();
  input?.select();
}
// Neu gezeichnete Fläche: gleich den Namen eintippen
watch(
  () => state.selection?.id,
  () => {
    if (editing.value && area.value && !area.value.name) void focusName();
  },
);

/* Wand, Säule, Tür und Fenster */
const wall = computed(() => editor.selectedWall.value);
const wallThicknessCm = cmField(
  () => wall.value?.thickness,
  (m) => {
    if (!wall.value) return;
    wall.value.thickness = m;
    // Die zuletzt gewählte Dicke gilt für die nächste Wand
    state.options.wallThickness = m;
  },
  2,
  200,
);
const wallOpenings = computed(() => (wall.value ? (content.value?.openings ?? []).filter((o) => o.wallId === wall.value!.id).length : 0));
const pillar = computed(() => editor.selectedPillar.value);
const pillarWidthCm = cmField(
  () => pillar.value?.width,
  (m) => {
    if (!pillar.value) return;
    pillar.value.width = m;
    if (pillar.value.shape === 'round') pillar.value.depth = m;
  },
  5,
  500,
);
const pillarDepthCm = cmField(() => pillar.value?.depth, (m) => pillar.value && (pillar.value.depth = m), 5, 500);
const pillarRotation = computed({
  get: () => pillar.value?.rotation ?? 0,
  set: (v: number | string) => {
    const n = Number(v);
    if (pillar.value && Number.isFinite(n)) pillar.value.rotation = ((Math.round(n) % 360) + 360) % 360;
  },
});
const opening = computed(() => editor.selectedOpening.value);
const openingTooWide = ref(false);
const openingWidthCm = computed({
  get: () => Math.round((opening.value?.width ?? 0) * 100),
  set: (v: number | string) => {
    const o = opening.value;
    const d = state.draft;
    const m = Number(v) / 100;
    if (!o || !d || !(m >= 0.2 && m <= 10)) return;
    const f = openingFrame(o, d.walls);
    if (!f) return;
    openingTooWide.value = m > f.len + 1e-9;
    if (openingTooWide.value) return;
    o.width = m;
    o.offset = Math.min(f.len - m / 2, Math.max(m / 2, o.offset));
  },
});
watch(
  () => state.selection?.id,
  () => (openingTooWide.value = false),
);
const isDoor = computed(() => opening.value?.kind === 'door' || opening.value?.kind === 'double');

const label = computed(() => editor.selectedLabel.value);

function print() {
  window.print();
}
</script>

<template>
  <div class="page stack plans-page">
    <div class="page-head">
      <h1>Pläne</h1>
      <span v-if="path" class="muted crumbs">{{ path }}</span>
    </div>
    <div v-if="loadError" class="error-box">{{ loadError }}</div>

    <div v-else class="plans">
      <aside class="card sidebar" aria-label="Standorte, Gebäude und Stockwerke">
        <div class="search">
          <input v-model="search" class="input" type="search" placeholder="Raum suchen" aria-label="Raum suchen" autocomplete="off" />
          <div v-if="search.trim()" class="results">
            <button v-for="h in hits" :key="h.id" type="button" class="result" @click="goToArea(h)">
              <span>
                {{ highlight(h.name)[0] }}<mark>{{ highlight(h.name)[1] }}</mark>{{ highlight(h.name)[2] }}
                <span v-if="h.kind !== 'room'" class="kind">{{ AREA_KIND_LABELS[h.kind] }}</span>
              </span>
              <span class="path">{{ h.site }} · {{ h.building }} · {{ h.floor }}<template v-if="h.description"> · {{ h.description }}</template></span>
            </button>
            <span v-if="!hits.length" class="hint">Nichts gefunden.</span>
          </div>
        </div>
        <PlanTree v-if="!loading" :tree="tree" :selected-floor-id="floor?.id ?? null" :can-edit="canEdit" @select="selectFloor" @changed="treeChanged" />
      </aside>

      <section class="card canvas-card" aria-label="Plan des Stockwerks">
        <template v-if="floor && content">
          <div class="toolbar">
            <div class="tools" role="group" aria-label="Werkzeuge">
              <button
                v-for="t in tools"
                :key="t"
                class="tool"
                :class="{ active: state.tool === t }"
                type="button"
                :aria-pressed="state.tool === t"
                :disabled="!!toolBlocked(t)"
                :title="toolBlocked(t) ?? undefined"
                @click="setTool(t)"
              >
                {{ TOOL_LABELS[t] }}
              </button>
            </div>
            <span class="spacer" />
            <details class="layers">
              <summary class="btn btn-sm">Ebenen</summary>
              <div class="layers-menu card">
                <label v-if="content.plan" class="checkbox small"><input v-model="state.layers.plan" type="checkbox" /> Plan</label>
                <label class="checkbox small"><input v-model="state.layers.areas" type="checkbox" /> Flächen</label>
                <label class="checkbox small"><input v-model="state.layers.structure" type="checkbox" /> Bauteile</label>
                <label class="checkbox small"><input v-model="state.layers.labels" type="checkbox" /> Beschriftungen</label>
                <span class="hint">Der Umriss ist immer sichtbar. Gilt auch für den Druck.</span>
              </div>
            </details>
            <template v-if="editing">
              <span v-if="editor.dirty.value" class="unsaved">Ungespeicherte Änderungen</span>
              <button class="btn btn-sm" type="button" @click="discardEdit">Verwerfen</button>
              <button class="btn btn-sm btn-primary" type="button" :disabled="state.saving" @click="saveFloor">Speichern</button>
            </template>
            <template v-else>
              <button class="btn btn-sm" type="button" @click="print">Drucken</button>
              <button v-if="canEdit" class="btn btn-sm" type="button" @click="editor.startEdit()">Bearbeiten</button>
            </template>
          </div>

          <!-- Einstellungen des Werkzeugs und Plan im Hintergrund -->
          <div v-if="editing" class="options">
            <template v-if="state.tool === 'outline' || state.tool === 'area'">
              <div class="seg" role="group" aria-label="Form">
                <button type="button" :class="{ active: state.options.shape === 'rect' }" :aria-pressed="state.options.shape === 'rect'" @click="setShape('rect')">
                  Rechteck
                </button>
                <button type="button" :class="{ active: state.options.shape === 'poly' }" :aria-pressed="state.options.shape === 'poly'" @click="setShape('poly')">
                  Vieleck
                </button>
              </div>
              <label v-if="state.tool === 'area'" class="opt">
                Art
                <select v-model="state.options.areaKind" class="input input-sm" aria-label="Art der neuen Fläche">
                  <option v-for="k in AREA_KINDS" :key="k" :value="k">{{ AREA_KIND_LABELS[k] }}</option>
                </select>
              </label>
            </template>
            <label v-else-if="state.tool === 'wall'" class="opt">
              Dicke <input v-model.number="wallCm" class="input input-sm num" type="number" min="2" max="200" aria-label="Dicke der Wand in cm" /> cm
            </label>
            <template v-else-if="state.tool === 'pillar'">
              <div class="seg" role="group" aria-label="Form der Säule">
                <button type="button" :class="{ active: state.options.pillarShape === 'rect' }" @click="state.options.pillarShape = 'rect'">Eckig</button>
                <button type="button" :class="{ active: state.options.pillarShape === 'round' }" @click="state.options.pillarShape = 'round'">Rund</button>
              </div>
              <label class="opt">
                Grösse <input v-model.number="pillarCm" class="input input-sm num" type="number" min="5" max="500" aria-label="Grösse der Säule in cm" /> cm
              </label>
            </template>
            <template v-else-if="state.tool === 'door'">
              <div class="seg" role="group" aria-label="Art der Tür">
                <button v-for="k in DOOR_KINDS" :key="k.value" type="button" :class="{ active: state.options.doorKind === k.value }" @click="state.options.doorKind = k.value">
                  {{ k.label }}
                </button>
              </div>
              <label class="opt">
                Breite <input v-model.number="doorWidthCm" class="input input-sm num" type="number" min="20" max="1000" aria-label="Breite der Tür in cm" /> cm
              </label>
            </template>
            <label v-else-if="state.tool === 'window'" class="opt">
              Breite <input v-model.number="windowWidthCm" class="input input-sm num" type="number" min="20" max="1000" aria-label="Breite des Fensters in cm" /> cm
            </label>
            <span class="spacer" />
            <label class="btn btn-sm" :class="{ disabled: converting }" for="plan-file" title="Bild (PNG, JPEG, WebP) oder PDF; bei mehreren Seiten wählst du die Seite">
              {{ converting ? 'Plan wird gelesen …' : content.plan ? 'Plan ersetzen …' : 'Plan hochladen …' }}
            </label>
            <input id="plan-file" type="file" accept="image/png,image/jpeg,image/webp,application/pdf,.pdf" hidden @change="onPlanFile" />
            <template v-if="content.plan">
              <button class="btn btn-sm" :class="{ pressed: state.tool === 'scale' }" type="button" :aria-pressed="state.tool === 'scale'" @click="setTool('scale')">
                Massstab setzen
              </button>
              <button class="btn btn-sm" type="button" @click="editor.removePlan()">Plan entfernen</button>
            </template>
          </div>
          <div v-if="state.saveError" class="save-error" role="alert">{{ state.saveError }}</div>
          <div class="tool-hint" :class="{ editing }">{{ hint }}</div>
          <PlanCanvas ref="canvas" :editor="editor" />
        </template>
        <div v-else-if="!loading" class="empty-plan">
          <p v-if="!tree.length">{{ canEdit ? 'Noch keine Pläne. Lege links mit «+ Standort» den ersten Standort an.' : 'Noch keine Pläne erfasst.' }}</p>
          <p v-else>{{ canEdit ? 'Noch kein Stockwerk. Füge links bei einem Gebäude mit «+» ein Stockwerk hinzu.' : 'Wähle links ein Stockwerk.' }}</p>
        </div>
      </section>

      <aside v-if="floor && content" class="card details" aria-label="Angaben">
        <!-- Massstab setzen -->
        <template v-if="state.tool === 'scale' && measuredLength !== null">
          <h2>Massstab setzen</h2>
          <span class="hint">Die markierte Strecke ist laut Plan {{ formatNumber(measuredLength, 2) }} m lang. Wie lang ist sie wirklich?</span>
          <div class="field">
            <label for="plan-scale-real">Echte Länge in Metern</label>
            <input id="plan-scale-real" v-model="realLength" class="input" inputmode="decimal" @keydown.enter="applyScale" />
          </div>
          <span class="hint">Alles Gezeichnete bleibt, wo es ist; nur der Plan im Hintergrund wird vergrössert oder verkleinert.</span>
          <div class="row">
            <button class="btn btn-primary" type="button" @click="applyScale">Übernehmen</button>
            <button class="btn" type="button" @click="state.scaleLine = null">Abbrechen</button>
          </div>
        </template>

        <!-- Umriss -->
        <template v-else-if="editor.outlineSelected.value && content.outline">
          <h2>Umriss</h2>
          <dl class="facts">
            <dt>Fläche</dt>
            <dd>{{ formatNumber(polygonArea(content.outline)) }} m²</dd>
            <dt>Ecken</dt>
            <dd>{{ content.outline.length }}</dd>
          </dl>
          <template v-if="editing">
            <span class="hint">
              Der Umriss umschliesst alles im Stockwerk. Flächen, die über ihn hinausgehen, lassen ihn wachsen; kleiner ziehen geht, solange er alles
              umschliesst.
            </span>
            <div class="row">
              <button class="btn btn-sm" type="button" @click="editor.addWallsAlong(content.outline)">Wände entlang des Umrisses</button>
              <button v-if="editor.outlineDeletable.value" class="btn btn-sm btn-danger" type="button" @click="editor.deleteSelected()">Umriss löschen</button>
            </div>
          </template>
          <div><button class="link-btn" type="button" @click="editor.select(null)">← Zum Stockwerk</button></div>
        </template>

        <!-- Fläche -->
        <template v-else-if="area && areaFacts">
          <template v-if="editing">
            <h2>Fläche</h2>
            <div class="field">
              <label for="plan-area-kind">Art</label>
              <select id="plan-area-kind" v-model="area.kind" class="input">
                <option v-for="k in AREA_KINDS" :key="k" :value="k">{{ AREA_KIND_LABELS[k] }}</option>
              </select>
            </div>
            <div class="field">
              <label for="plan-area-name">Name</label>
              <input id="plan-area-name" v-model="area.name" class="input" maxlength="60" :placeholder="area.kind === 'room' ? '' : 'freiwillig, z.B. Gang Nord'" />
              <span v-if="nameDuplicate" class="error-text small">Diesen Namen gibt es in diesem Stockwerk schon. Jede Fläche braucht einen eigenen Namen.</span>
              <span v-else-if="area.kind === 'room'" class="hint">So nennen ihn alle. Pflicht bei Räumen, eindeutig im Stockwerk.</span>
              <span v-else class="hint">Freiwillig; ohne Namen zeigt der Plan die Art.</span>
            </div>
            <div class="field">
              <label for="plan-area-description">Beschreibung</label>
              <textarea id="plan-area-description" v-model="area.description" class="textarea" maxlength="200" rows="3" placeholder="z.B. Beamer, 12 Plätze" />
            </div>
          </template>
          <template v-else>
            <h2>{{ areaTitle(area) }}</h2>
            <span v-if="area.kind !== 'room' && area.name" class="muted small">{{ AREA_KIND_LABELS[area.kind] }}</span>
            <span v-if="area.description">{{ area.description }}</span>
            <span v-else class="faint">Keine Beschreibung</span>
          </template>
          <dl class="facts">
            <dt>Fläche</dt>
            <dd>{{ areaFacts.area }} m²</dd>
            <template v-if="areaFacts.size">
              <dt>Masse</dt>
              <dd>{{ areaFacts.size }}</dd>
            </template>
            <dt>Standort</dt>
            <dd>{{ floor.site.name }}</dd>
            <dt>Gebäude</dt>
            <dd>{{ floor.building.name }}</dd>
            <dt>Stockwerk</dt>
            <dd>{{ floor.name }}</dd>
          </dl>
          <template v-if="editing">
            <div><button class="btn btn-sm" type="button" @click="editor.addWallsAlong(area.points)">Wände entlang der Fläche</button></div>
            <div v-if="state.confirmDelete" class="confirm">
              Fläche «{{ areaTitle(area) }}» löschen?
              <div class="row">
                <button class="btn btn-sm btn-danger" type="button" @click="editor.deleteSelected()">Löschen</button>
                <button class="btn btn-sm" type="button" @click="state.confirmDelete = false">Abbrechen</button>
              </div>
            </div>
            <div v-else><button class="btn btn-sm btn-danger" type="button" @click="state.confirmDelete = true">Fläche löschen</button></div>
          </template>
          <div><button class="link-btn" type="button" @click="editor.select(null)">← Alle Flächen des Stockwerks</button></div>
        </template>

        <!-- Wand -->
        <template v-else-if="wall && editing">
          <h2>Wand</h2>
          <div class="field">
            <label for="plan-wall-thickness">Dicke in cm</label>
            <input id="plan-wall-thickness" v-model.number="wallThicknessCm" class="input" type="number" min="2" max="200" />
          </div>
          <dl class="facts">
            <dt>Länge</dt>
            <dd>{{ formatNumber(polylineLength(wall.points, wall.closed), 2) }} m</dd>
            <dt>Ecken</dt>
            <dd>{{ wall.points.length }}{{ wall.closed ? ', geschlossen' : '' }}</dd>
            <dt>Türen, Fenster</dt>
            <dd>{{ wallOpenings }}</dd>
          </dl>
          <span class="hint">Die Wand sitzt mittig auf der Linie. Türen und Fenster wandern mit, wenn du die Wand verschiebst.</span>
          <div><button class="btn btn-sm btn-danger" type="button" @click="editor.deleteSelected()">Wand löschen</button></div>
        </template>

        <!-- Säule -->
        <template v-else-if="pillar && editing">
          <h2>Säule</h2>
          <div class="field">
            <label for="plan-pillar-shape">Form</label>
            <select id="plan-pillar-shape" v-model="pillar.shape" class="input" @change="pillar.shape === 'round' && (pillar.depth = pillar.width)">
              <option value="rect">Eckig</option>
              <option value="round">Rund</option>
            </select>
          </div>
          <div class="field-row">
            <div class="field">
              <label for="plan-pillar-width">{{ pillar.shape === 'round' ? 'Durchmesser in cm' : 'Breite in cm' }}</label>
              <input id="plan-pillar-width" v-model.number="pillarWidthCm" class="input" type="number" min="5" max="500" />
            </div>
            <div v-if="pillar.shape === 'rect'" class="field">
              <label for="plan-pillar-depth">Tiefe in cm</label>
              <input id="plan-pillar-depth" v-model.number="pillarDepthCm" class="input" type="number" min="5" max="500" />
            </div>
          </div>
          <div v-if="pillar.shape === 'rect'" class="field">
            <label for="plan-pillar-rotation">Drehung in Grad</label>
            <input id="plan-pillar-rotation" v-model.number="pillarRotation" class="input" type="number" min="0" max="359" step="5" />
          </div>
          <div><button class="btn btn-sm btn-danger" type="button" @click="editor.deleteSelected()">Säule löschen</button></div>
        </template>

        <!-- Tür, Öffnung, Fenster -->
        <template v-else-if="opening && editing">
          <h2>{{ OPENING_LABELS[opening.kind] }}</h2>
          <div class="field">
            <label for="plan-opening-kind">Art</label>
            <select id="plan-opening-kind" v-model="opening.kind" class="input">
              <option v-for="(text, k) in OPENING_LABELS" :key="k" :value="k">{{ text }}</option>
            </select>
          </div>
          <div class="field">
            <label for="plan-opening-width">Breite in cm</label>
            <input id="plan-opening-width" v-model.number="openingWidthCm" class="input" type="number" min="20" max="1000" />
            <span v-if="openingTooWide" class="error-text small">So breit ist dieses Wandstück nicht.</span>
          </div>
          <div v-if="isDoor" class="row">
            <button v-if="opening.kind === 'door'" class="btn btn-sm" type="button" @click="opening.hinge = opening.hinge === 'start' ? 'end' : 'start'">
              Anschlag wechseln
            </button>
            <button class="btn btn-sm" type="button" @click="opening.side = opening.side === 'left' ? 'right' : 'left'">Aufschlag wechseln</button>
          </div>
          <span class="hint">Ziehen verschiebt sie entlang der Wand oder in eine andere Wand.</span>
          <div><button class="btn btn-sm btn-danger" type="button" @click="editor.deleteSelected()">{{ OPENING_LABELS[opening.kind] }} löschen</button></div>
        </template>

        <!-- Beschriftung -->
        <template v-else-if="label && editing">
          <h2>Beschriftung</h2>
          <div class="field">
            <label for="plan-label-text">Text</label>
            <input id="plan-label-text" v-model="label.text" class="input" maxlength="40" />
          </div>
          <span class="hint">Für Hinweise wie Notausgang oder Haupteingang. Gänge, Treppenhäuser und Lifte zeichnest du besser als Fläche; Beschriftungen erscheinen nicht in der Suche.</span>
          <div><button class="btn btn-sm btn-danger" type="button" @click="editor.deleteSelected()">Beschriftung löschen</button></div>
        </template>

        <!-- Stockwerk -->
        <template v-else>
          <h2>{{ floor.name }}</h2>
          <span class="muted small">{{ floor.site.name }} · {{ floor.building.name }}</span>
          <dl class="facts">
            <dt>Umriss</dt>
            <dd>{{ content.outline ? `${formatNumber(polygonArea(content.outline))} m²` : 'noch keiner' }}</dd>
            <template v-for="k in kindSummary" :key="k.kind">
              <dt>{{ k.count === 1 ? AREA_KIND_LABELS[k.kind] : AREA_KIND_PLURALS[k.kind] }}</dt>
              <dd>{{ k.count > 1 ? `${k.count} · ` : '' }}{{ formatNumber(k.area) }} m²</dd>
            </template>
            <dt>Bauteile</dt>
            <dd>{{ structureSummary }}</dd>
            <dt>Plan</dt>
            <dd>{{ content.plan ? (content.plan.calibrated ? 'mit gesetztem Massstab' : 'Massstab noch nicht gesetzt') : 'ohne Vorlage gezeichnet' }}</dd>
          </dl>
          <hr class="sep" />
          <div class="area-list">
            <button v-for="a in sortedAreas" :key="a.id" type="button" @click="pickArea(a.id)">
              <span :class="{ unnamed: !a.name.trim() }">
                {{ areaTitle(a) }}<span v-if="a.kind !== 'room' && a.name.trim()" class="kind">{{ AREA_KIND_LABELS[a.kind] }}</span>
              </span>
              <span class="size">{{ formatNumber(polygonArea(a.points)) }} m²</span>
            </button>
            <span v-if="!sortedAreas.length" class="faint">{{ editing ? 'Noch nichts gezeichnet: mit «Umriss» oder «Fläche» beginnen.' : 'Noch keine Flächen.' }}</span>
          </div>
        </template>
      </aside>
    </div>

    <PlanPrint v-if="floor && content && editor.bounds.value" :title="path" :content="content" :bounds="editor.bounds.value" :layers="state.layers" />
    <PlanPdfDialog v-if="pdfChoice" :pdf="pdfChoice.pdf" :file-name="pdfChoice.name" @choose="usePdfPage(pdfChoice.pdf, $event)" @close="pdfChoice.pdf.close(); pdfChoice = null" />
    <ModalDialog v-if="leaveDialog" title="Ungespeicherte Änderungen" @close="closeLeave(false)">
      <p class="leave-text">Das Stockwerk «{{ floor?.name }}» hat ungespeicherte Änderungen. Speichern oder verwerfen?</p>
      <div v-if="state.saveError" class="error-box">{{ state.saveError }}</div>
      <template #footer>
        <button class="btn" type="button" @click="closeLeave(false)">Zurück</button>
        <button class="btn btn-danger" type="button" @click="leaveWithDiscard">Verwerfen</button>
        <button class="btn btn-primary" type="button" :disabled="state.saving" @click="leaveWithSave">Speichern</button>
      </template>
    </ModalDialog>
  </div>
</template>

<style scoped>
.plans-page {
  max-width: 1800px;
}
.crumbs {
  font-size: 13px;
}
.plans {
  display: grid;
  grid-template-columns: 270px minmax(0, 1fr) 280px;
  gap: 12px;
  align-items: start;
}
@media (max-width: 1200px) {
  .plans {
    grid-template-columns: 240px minmax(0, 1fr);
  }
  .details {
    grid-column: 1 / -1;
  }
}
@media (max-width: 760px) {
  .plans {
    grid-template-columns: minmax(0, 1fr);
  }
}
.sidebar {
  padding: 12px;
  display: flex;
  flex-direction: column;
  gap: 12px;
  min-width: 0;
}
.results {
  display: flex;
  flex-direction: column;
  gap: 2px;
  margin-top: 6px;
}
.result {
  text-align: left;
  background: none;
  border: 0;
  border-radius: var(--radius-sm);
  padding: 6px 8px;
  cursor: pointer;
  display: flex;
  flex-direction: column;
  font: inherit;
  color: var(--text);
}
.result:hover {
  background: var(--surface-hover);
}
.result .path {
  font-size: 12px;
  color: var(--text-faint);
}
.result mark {
  background: var(--accent-soft);
  color: inherit;
  border-radius: 2px;
}
.kind {
  margin-left: 6px;
  font-size: 11px;
  color: var(--text-faint);
}
.canvas-card {
  display: flex;
  flex-direction: column;
  min-width: 0;
  overflow: hidden;
}
.toolbar,
.options {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 6px;
  padding: 8px 10px;
  border-bottom: 1px solid var(--border);
}
.options {
  padding: 6px 10px;
  background: var(--surface-2);
  font-size: 13px;
}
.spacer {
  flex: 1;
}
.tools,
.seg {
  display: inline-flex;
  flex-wrap: wrap;
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  overflow: hidden;
  background: var(--surface);
}
.tool,
.seg button {
  height: 30px;
  padding: 0 10px;
  border: 0;
  border-right: 1px solid var(--border);
  background: transparent;
  color: var(--text-muted);
  cursor: pointer;
  font: inherit;
  white-space: nowrap;
}
.seg button {
  height: 26px;
  padding: 0 9px;
  font-size: 13px;
}
.tool:last-child,
.seg button:last-child {
  border-right: 0;
}
.tool:hover:not(:disabled),
.seg button:hover {
  background: var(--surface-hover);
}
.tool.active,
.seg button.active {
  background: var(--accent-soft);
  color: var(--accent);
  font-weight: 600;
}
.tool:disabled {
  opacity: 0.45;
  cursor: default;
}
.opt {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  color: var(--text-muted);
}
.input-sm {
  height: 28px;
  padding: 2px 6px;
  font-size: 13px;
  width: auto;
}
.input-sm.num {
  width: 72px;
}
.btn.pressed {
  background: var(--accent-soft);
  color: var(--accent);
  border-color: var(--accent);
}
.btn.disabled {
  opacity: 0.6;
  pointer-events: none;
}
.layers {
  position: relative;
}
.layers summary {
  list-style: none;
}
.layers summary::-webkit-details-marker {
  display: none;
}
.layers-menu {
  position: absolute;
  right: 0;
  top: calc(100% + 4px);
  z-index: 20;
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 10px 12px;
  min-width: 200px;
  box-shadow: var(--shadow-md, 0 6px 20px rgb(0 0 0 / 0.12));
}
.unsaved {
  font-size: 12px;
  color: var(--warning);
  white-space: nowrap;
}
.save-error {
  padding: 8px 12px;
  font-size: 13px;
  background: var(--danger-soft);
  color: var(--danger);
  border-bottom: 1px solid var(--border);
}
.tool-hint {
  padding: 6px 12px;
  font-size: 12px;
  color: var(--text-muted);
  background: var(--surface-2);
  border-bottom: 1px solid var(--border);
  min-height: 30px;
}
/* Beim Bearbeiten Platz für zwei Zeilen: sonst springt die Zeichenfläche beim Wechsel des Werkzeugs */
.tool-hint.editing {
  min-height: 48px;
}
.options + .save-error + .tool-hint,
.options + .tool-hint {
  background: var(--surface);
}
.empty-plan {
  padding: 48px 24px;
  text-align: center;
  color: var(--text-muted);
}
.details {
  padding: 14px;
  display: flex;
  flex-direction: column;
  gap: 12px;
  min-width: 0;
}
.details h2 {
  margin: 0;
  font-size: 15px;
  overflow-wrap: anywhere;
}
.field-row {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 8px;
}
.facts {
  display: grid;
  grid-template-columns: max-content 1fr;
  gap: 4px 12px;
  font-size: 13px;
  margin: 0;
}
.facts dt {
  color: var(--text-muted);
}
.facts dd {
  margin: 0;
  font-variant-numeric: tabular-nums;
  overflow-wrap: anywhere;
}
.sep {
  border: 0;
  border-top: 1px solid var(--border);
  margin: 0;
}
.area-list {
  display: flex;
  flex-direction: column;
  gap: 1px;
  max-height: 340px;
  overflow: auto;
}
.area-list button {
  display: flex;
  justify-content: space-between;
  gap: 8px;
  text-align: left;
  background: none;
  border: 0;
  border-radius: var(--radius-sm);
  padding: 5px 6px;
  cursor: pointer;
  font: inherit;
  color: var(--text);
}
.area-list button:hover {
  background: var(--surface-hover);
}
.area-list .unnamed {
  color: var(--text-muted);
  font-style: italic;
}
.area-list .size {
  color: var(--text-faint);
  font-size: 12px;
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
}
.confirm {
  background: var(--danger-soft);
  color: var(--danger);
  border-radius: var(--radius-sm);
  padding: 8px 10px;
  font-size: 13px;
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.error-text {
  color: var(--danger);
}
.leave-text {
  margin: 0;
}
</style>
