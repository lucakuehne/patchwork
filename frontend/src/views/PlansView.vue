<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { onBeforeRouteLeave, useRoute, useRouter } from 'vue-router';
import { api, errorMessage } from '../api';
import ModalDialog from '../components/ModalDialog.vue';
import PlanCanvas from '../components/plans/PlanCanvas.vue';
import PlanPdfDialog from '../components/plans/PlanPdfDialog.vue';
import PlanPrint from '../components/plans/PlanPrint.vue';
import PlanTree from '../components/plans/PlanTree.vue';
import { usePlanEditor, type PlanTool } from '../plans/editor';
import { bbox, dist, duplicateNames, formatNumber, isRect, polygonArea } from '../plans/geometry';
import { imageSize, openPdf, type PdfPages } from '../plans/pdf';
import { useSession } from '../stores/session';
import { useToast } from '../stores/toast';
import type { PlanFloor, PlanSearchHit, PlanTreeSite } from '../types';

/**
 * Pläne (Entscheid vom 20.11.2026): Standorte, Gebäude, Stockwerke und Räume massstabsgetreu, damit alle wissen, wo
 * welcher Raum ist, und ihn gleich nennen. Ansehen mit dem Recht «Pläne ansehen», ändern mit «Pläne bearbeiten».
 * Adresse: /plans?floor=<id>&room=<id>
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
const path = computed(() => (floor.value ? `${floor.value.site.name} · ${floor.value.building.name} · ${floor.value.name}` : ''));

async function loadTree() {
  tree.value = await api.get<PlanTreeSite[]>('/plans');
}
const firstFloorId = () => tree.value.flatMap((s) => s.buildings.flatMap((b) => b.floors))[0]?.id ?? null;
const floorExists = (id: string) => tree.value.some((s) => s.buildings.some((b) => b.floors.some((f) => f.id === id)));

async function openFloor(id: string | null, roomId?: string) {
  if (!id) {
    state.floor = null;
    editor.discard();
    void router.replace({ query: {} });
    return;
  }
  try {
    editor.show(await api.get<PlanFloor>(`/plans/floors/${id}`));
    if (route.query.floor !== id || (route.query.room && route.query.room !== roomId)) {
      void router.replace({ query: { floor: id, ...(roomId ? { room: roomId } : {}) } });
    }
    if (roomId) {
      await nextTick();
      canvas.value?.focusRoom(roomId);
      editor.select('room', roomId);
    }
  } catch (err) {
    toast.error(err);
  }
}

onMounted(async () => {
  try {
    await loadTree();
    const wanted = typeof route.query.floor === 'string' && floorExists(route.query.floor) ? route.query.floor : firstFloorId();
    await openFloor(wanted, typeof route.query.room === 'string' ? route.query.room : undefined);
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
    if (editor.editing.value) editor.discard();
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
  if (current && !editor.editing.value) await openFloor(current);
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
async function goToRoom(hit: PlanSearchHit) {
  if (!(await askLeave())) return;
  if (floor.value?.id !== hit.floorId) await openFloor(hit.floorId, hit.id);
  else {
    canvas.value?.focusRoom(hit.id);
    editor.select('room', hit.id);
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
  rect: 'Rechteck',
  poly: 'Vieleck',
  label: 'Beschriftung',
  measure: 'Messen',
  scale: 'Massstab setzen',
};
const tools = computed<PlanTool[]>(() => (editor.editing.value ? ['select', 'rect', 'poly', 'label', 'measure', 'scale'] : ['select', 'measure']));
const HINTS: Record<'view' | 'edit', Partial<Record<PlanTool, string>>> = {
  view: {
    select: 'Raum anklicken für seine Angaben. Ziehen verschiebt den Plan, das Mausrad vergrössert.',
    measure: 'Messen: Anfang und Ende einer Strecke anklicken. Ein weiterer Klick beginnt neu, Esc löscht.',
  },
  edit: {
    select: 'Raum oder Beschriftung anklicken, um sie zu ändern. Räume und ihre Ecken lassen sich ziehen, Entf löscht.',
    rect: 'Rechteck: an einer Ecke drücken und zur gegenüberliegenden ziehen. Raster 10 cm, rastet an Ecken anderer Räume ein.',
    poly: 'Vieleck: Ecken nacheinander anklicken, zum Abschliessen den ersten Punkt anklicken oder doppelklicken. Rücktaste nimmt die letzte Ecke weg.',
    label: 'Beschriftung: an die Stelle klicken, z.B. für Treppenhaus, Lift oder Eingang.',
    measure: 'Messen: Anfang und Ende einer Strecke anklicken.',
    scale: 'Massstab setzen: Anfang und Ende einer Strecke anklicken, deren Länge du kennst (z.B. eine Aussenwand), dann die echte Länge eingeben.',
  },
};
const hint = computed(() => HINTS[editor.editing.value ? 'edit' : 'view'][state.tool] ?? '');
function setTool(t: PlanTool) {
  editor.resetTools();
  state.tool = t;
}

/* ---------- Bearbeiten ---------- */
async function saveFloor(): Promise<boolean> {
  const id = floor.value?.id;
  const selection = state.selection;
  if (!id || !(await editor.save())) return false;
  try {
    editor.show(await api.get<PlanFloor>(`/plans/floors/${id}`));
    if (selection && editor.content.value?.[selection.kind === 'room' ? 'rooms' : 'labels'].some((x) => x.id === selection.id)) {
      state.selection = selection;
    }
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
const roomFacts = computed(() => {
  const r = editor.selectedRoom.value;
  if (!r) return null;
  const b = bbox(r.points);
  return { area: formatNumber(polygonArea(r.points)), size: isRect(r.points) ? `${formatNumber(b.w)} × ${formatNumber(b.h)} m` : null };
});
const nameDuplicate = computed(() => {
  const r = editor.selectedRoom.value;
  if (!r || !content.value || !r.name.trim()) return false;
  return duplicateNames(content.value.rooms.map((x) => x.name)).some((n) => n.toLowerCase() === r.name.trim().toLowerCase());
});
const sortedRooms = computed(() => [...(content.value?.rooms ?? [])].sort((a, b) => a.name.localeCompare(b.name, 'de', { numeric: true })));
const totalArea = computed(() => (content.value?.rooms ?? []).reduce((s, r) => s + polygonArea(r.points), 0));
function pickRoom(id: string) {
  editor.select('room', id);
  canvas.value?.focusRoom(id);
}
async function focusName() {
  await nextTick();
  const input = document.getElementById('plan-room-name') as HTMLInputElement | null;
  input?.focus();
  input?.select();
}
// Neu gezeichneter Raum: gleich den Namen eintippen
watch(
  () => state.selection?.id,
  () => {
    if (editor.editing.value && editor.selectedRoom.value && !editor.selectedRoom.value.name) void focusName();
  },
);

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
            <button v-for="h in hits" :key="h.id" type="button" class="result" @click="goToRoom(h)">
              <span>{{ highlight(h.name)[0] }}<mark>{{ highlight(h.name)[1] }}</mark>{{ highlight(h.name)[2] }}</span>
              <span class="path">{{ h.site }} · {{ h.building }} · {{ h.floor }}<template v-if="h.description"> · {{ h.description }}</template></span>
            </button>
            <span v-if="!hits.length" class="hint">Kein Raum gefunden.</span>
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
                :disabled="t === 'scale' && !content.plan"
                :title="t === 'scale' && !content.plan ? 'Erst einen Plan hochladen' : undefined"
                @click="setTool(t)"
              >
                {{ TOOL_LABELS[t] }}
              </button>
            </div>
            <span class="spacer" />
            <label v-if="content.plan" class="checkbox small"><input v-model="state.showPlan" type="checkbox" /> Plan zeigen</label>
            <template v-if="editor.editing.value">
              <label class="btn btn-sm" :class="{ disabled: converting }" for="plan-file" title="Bild (PNG, JPEG, WebP) oder PDF; bei mehreren Seiten wählst du die Seite">
                {{ converting ? 'Plan wird gelesen …' : content.plan ? 'Plan ersetzen …' : 'Plan hochladen …' }}
              </label>
              <input id="plan-file" type="file" accept="image/png,image/jpeg,image/webp,application/pdf,.pdf" hidden @change="onPlanFile" />
              <button v-if="content.plan" class="btn btn-sm" type="button" @click="editor.removePlan()">Plan entfernen</button>
              <span v-if="editor.dirty.value" class="unsaved">Ungespeicherte Änderungen</span>
              <button class="btn btn-sm" type="button" @click="discardEdit">Verwerfen</button>
              <button class="btn btn-sm btn-primary" type="button" :disabled="state.saving" @click="saveFloor">Speichern</button>
            </template>
            <template v-else>
              <button class="btn btn-sm" type="button" @click="print">Drucken</button>
              <button v-if="canEdit" class="btn btn-sm" type="button" @click="editor.startEdit()">Bearbeiten</button>
            </template>
          </div>
          <div v-if="state.saveError" class="save-error" role="alert">{{ state.saveError }}</div>
          <div class="tool-hint">{{ hint }}</div>
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
          <span class="hint">Räume und Beschriftungen bleiben, wo sie sind; nur der Plan im Hintergrund wird vergrössert oder verkleinert.</span>
          <div class="row">
            <button class="btn btn-primary" type="button" @click="applyScale">Übernehmen</button>
            <button class="btn" type="button" @click="state.scaleLine = null">Abbrechen</button>
          </div>
        </template>

        <!-- Raum -->
        <template v-else-if="editor.selectedRoom.value && roomFacts">
          <template v-if="editor.editing.value">
            <h2>Raum</h2>
            <div class="field">
              <label for="plan-room-name">Name</label>
              <input id="plan-room-name" v-model="editor.selectedRoom.value.name" class="input" maxlength="60" />
              <span v-if="nameDuplicate" class="error-text small">Diesen Namen gibt es in diesem Stockwerk schon. Jeder Raum eines Stockwerks braucht einen eigenen Namen.</span>
              <span v-else class="hint">So nennen ihn alle. Eindeutig im Stockwerk.</span>
            </div>
            <div class="field">
              <label for="plan-room-description">Beschreibung</label>
              <textarea id="plan-room-description" v-model="editor.selectedRoom.value.description" class="textarea" maxlength="200" rows="3" placeholder="z.B. Beamer, 12 Plätze" />
            </div>
          </template>
          <template v-else>
            <h2>{{ editor.selectedRoom.value.name }}</h2>
            <span v-if="editor.selectedRoom.value.description">{{ editor.selectedRoom.value.description }}</span>
            <span v-else class="faint">Keine Beschreibung</span>
          </template>
          <dl class="facts">
            <dt>Fläche</dt>
            <dd>{{ roomFacts.area }} m²</dd>
            <template v-if="roomFacts.size">
              <dt>Masse</dt>
              <dd>{{ roomFacts.size }}</dd>
            </template>
            <dt>Standort</dt>
            <dd>{{ floor.site.name }}</dd>
            <dt>Gebäude</dt>
            <dd>{{ floor.building.name }}</dd>
            <dt>Stockwerk</dt>
            <dd>{{ floor.name }}</dd>
          </dl>
          <template v-if="editor.editing.value">
            <div v-if="state.confirmDelete" class="confirm">
              Raum «{{ editor.selectedRoom.value.name || 'ohne Namen' }}» löschen?
              <div class="row">
                <button class="btn btn-sm btn-danger" type="button" @click="editor.deleteSelected()">Löschen</button>
                <button class="btn btn-sm" type="button" @click="state.confirmDelete = false">Abbrechen</button>
              </div>
            </div>
            <div v-else><button class="btn btn-sm btn-danger" type="button" @click="state.confirmDelete = true">Raum löschen</button></div>
          </template>
          <div><button class="link-btn" type="button" @click="editor.select(null)">← Alle Räume des Stockwerks</button></div>
        </template>

        <!-- Beschriftung -->
        <template v-else-if="editor.selectedLabel.value && editor.editing.value">
          <h2>Beschriftung</h2>
          <div class="field">
            <label for="plan-label-text">Text</label>
            <input id="plan-label-text" v-model="editor.selectedLabel.value.text" class="input" maxlength="40" />
          </div>
          <span class="hint">Für Treppenhaus, Lift, Eingang usw. Beschriftungen sind keine Räume und erscheinen nicht in der Suche.</span>
          <div><button class="btn btn-sm btn-danger" type="button" @click="editor.deleteSelected()">Beschriftung löschen</button></div>
        </template>

        <!-- Stockwerk -->
        <template v-else>
          <h2>{{ floor.name }}</h2>
          <span class="muted small">{{ floor.site.name }} · {{ floor.building.name }}</span>
          <dl class="facts">
            <dt>Räume</dt>
            <dd>{{ content.rooms.length }}</dd>
            <dt>Fläche</dt>
            <dd>{{ formatNumber(totalArea) }} m²</dd>
            <dt>Plan</dt>
            <dd>{{ content.plan ? (content.plan.calibrated ? 'mit gesetztem Massstab' : 'Massstab noch nicht gesetzt') : 'ohne Vorlage gezeichnet' }}</dd>
          </dl>
          <hr class="sep" />
          <div class="room-list">
            <button v-for="r in sortedRooms" :key="r.id" type="button" @click="pickRoom(r.id)">
              <span>{{ r.name || 'Ohne Namen' }}</span>
              <span class="area">{{ formatNumber(polygonArea(r.points)) }} m²</span>
            </button>
            <span v-if="!sortedRooms.length" class="faint">{{ editor.editing.value ? 'Noch keine Räume: mit «Rechteck» oder «Vieleck» zeichnen.' : 'Noch keine Räume.' }}</span>
          </div>
        </template>
      </aside>
    </div>

    <PlanPrint v-if="floor && content && editor.bounds.value" :title="path" :content="content" :bounds="editor.bounds.value" :show-plan="state.showPlan" />
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
.canvas-card {
  display: flex;
  flex-direction: column;
  min-width: 0;
  overflow: hidden;
}
.toolbar {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 6px;
  padding: 8px 10px;
  border-bottom: 1px solid var(--border);
}
.spacer {
  flex: 1;
}
.tools {
  display: inline-flex;
  flex-wrap: wrap;
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  overflow: hidden;
}
.tool {
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
.tool:last-child {
  border-right: 0;
}
.tool:hover:not(:disabled) {
  background: var(--surface-hover);
}
.tool.active {
  background: var(--accent-soft);
  color: var(--accent);
  font-weight: 600;
}
.tool:disabled {
  opacity: 0.5;
  cursor: default;
}
.btn.disabled {
  opacity: 0.6;
  pointer-events: none;
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
.room-list {
  display: flex;
  flex-direction: column;
  gap: 1px;
  max-height: 340px;
  overflow: auto;
}
.room-list button {
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
.room-list button:hover {
  background: var(--surface-hover);
}
.room-list .area {
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
