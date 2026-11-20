<script setup lang="ts">
import { computed, nextTick, reactive, ref, watch } from 'vue';
import { api, errorMessage } from '../../api';
import { nextFloorName } from '../../plans/geometry';
import type { PlanTreeSite } from '../../types';
import ModalDialog from '../ModalDialog.vue';

/**
 * Baum der Pläne (Entscheid vom 20.11.2026): Standort → Gebäude → Stockwerk, auf- und zuklappbar. Admins legen
 * jederzeit an, benennen um und löschen (mit Rückfrage, die nennt, was wegfällt); Stockwerke ordnen sie durch Ziehen
 * (oberstes zuoberst). Das gilt sofort, ohne «Speichern».
 */
const props = defineProps<{ tree: PlanTreeSite[]; selectedFloorId: string | null; canEdit: boolean }>();
const emit = defineEmits<{
  /** Stockwerk öffnen */
  select: [floorId: string];
  /** Baum geändert; «open»: dieses Stockwerk öffnen (neu angelegt), «removed»: gelöschte Stockwerke */
  changed: [change: { open?: string; removed?: string[] }];
}>();

type Kind = 'site' | 'building' | 'floor';
const KIND_LABELS: Record<Kind, string> = { site: 'Standort', building: 'Gebäude', floor: 'Stockwerk' };
const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/* Auf- und zuklappen: alles offen, bis man zuklappt */
const collapsed = reactive(new Set<string>());
const toggle = (id: string) => (collapsed.has(id) ? collapsed.delete(id) : collapsed.add(id));
watch(
  () => props.selectedFloorId,
  (id) => {
    // Das gewählte Stockwerk bleibt sichtbar
    for (const site of props.tree)
      for (const building of site.buildings)
        if (building.floors.some((f) => f.id === id)) {
          collapsed.delete(site.id);
          collapsed.delete(building.id);
        }
  },
  { immediate: true },
);

/* ---------- Anlegen und Umbenennen ---------- */
const nameDialog = ref<{ mode: 'add' | 'rename'; kind: Kind; parentId: string | null; id: string | null; name: string } | null>(null);
const nameError = ref('');
const busy = ref(false);
const nameInput = ref<HTMLInputElement | null>(null);

function openName(mode: 'add' | 'rename', kind: Kind, parentId: string | null, id: string | null, name = '') {
  nameDialog.value = { mode, kind, parentId, id, name };
  nameError.value = '';
  void nextTick(() => {
    nameInput.value?.focus();
    nameInput.value?.select();
  });
}
function addFloor(buildingId: string, topName: string | undefined) {
  openName('add', 'floor', buildingId, null, nextFloorName(topName));
}

async function submitName() {
  const d = nameDialog.value;
  if (!d || busy.value) return;
  const name = d.name.trim();
  if (!name) {
    nameError.value = 'Bitte einen Namen eingeben.';
    return;
  }
  busy.value = true;
  try {
    if (d.mode === 'rename') {
      const path = { site: 'sites', building: 'buildings', floor: 'floors' }[d.kind];
      await api.put(`/plans/${path}/${d.id}`, { name });
      emit('changed', {});
    } else if (d.kind === 'site') {
      await api.post('/plans/sites', { name });
      emit('changed', {});
    } else if (d.kind === 'building') {
      const b = await api.post<{ id: string }>(`/plans/sites/${d.parentId}/buildings`, { name });
      collapsed.delete(d.parentId!);
      collapsed.delete(b.id);
      emit('changed', {});
    } else {
      const f = await api.post<{ id: string }>(`/plans/buildings/${d.parentId}/floors`, { name });
      emit('changed', { open: f.id });
    }
    nameDialog.value = null;
  } catch (err) {
    nameError.value = errorMessage(err);
  } finally {
    busy.value = false;
  }
}

/* ---------- Löschen mit Rückfrage ---------- */
const deleteDialog = ref<{ kind: Kind; id: string; name: string; summary: string; floorIds: string[] } | null>(null);
const deleteError = ref('');

function askDelete(kind: Kind, id: string) {
  for (const site of props.tree) {
    const floorsOf = (buildings = site.buildings) => buildings.flatMap((b) => b.floors);
    const summarize = (floors: { id: string; roomCount: number }[], buildings?: number) => {
      const rooms = floors.reduce((s, f) => s + f.roomCount, 0);
      return [
        buildings !== undefined ? plural(buildings, 'Gebäude', 'Gebäude') : null,
        kind !== 'floor' ? plural(floors.length, 'Stockwerk', 'Stockwerke') : null,
        plural(rooms, 'Raum', 'Räume'),
      ]
        .filter(Boolean)
        .join(', ');
    };
    if (kind === 'site' && site.id === id) {
      const floors = floorsOf();
      deleteDialog.value = { kind, id, name: site.name, summary: summarize(floors, site.buildings.length), floorIds: floors.map((f) => f.id) };
    }
    for (const building of site.buildings) {
      if (kind === 'building' && building.id === id) {
        deleteDialog.value = { kind, id, name: building.name, summary: summarize(building.floors), floorIds: building.floors.map((f) => f.id) };
      }
      const floor = building.floors.find((f) => f.id === id);
      if (kind === 'floor' && floor) {
        deleteDialog.value = { kind, id, name: floor.name, summary: summarize([floor]), floorIds: [floor.id] };
      }
    }
  }
  deleteError.value = '';
}

async function confirmDelete() {
  const d = deleteDialog.value;
  if (!d || busy.value) return;
  busy.value = true;
  try {
    const path = { site: 'sites', building: 'buildings', floor: 'floors' }[d.kind];
    await api.delete(`/plans/${path}/${d.id}`);
    deleteDialog.value = null;
    emit('changed', { removed: d.floorIds });
  } catch (err) {
    deleteError.value = errorMessage(err);
  } finally {
    busy.value = false;
  }
}

/* ---------- Stockwerke durch Ziehen umordnen ---------- */
const dragging = ref<{ floorId: string; buildingId: string } | null>(null);
const dropAt = ref<{ floorId: string; before: boolean } | null>(null);

function onDragStart(e: DragEvent, buildingId: string, floorId: string) {
  if (!props.canEdit) return;
  dragging.value = { floorId, buildingId };
  e.dataTransfer?.setData('text/plain', floorId);
  if (e.dataTransfer) e.dataTransfer.effectAllowed = 'move';
}
function onDragOver(e: DragEvent, buildingId: string, floorId: string) {
  if (!dragging.value || dragging.value.buildingId !== buildingId) return;
  e.preventDefault();
  const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
  dropAt.value = { floorId, before: e.clientY < r.top + r.height / 2 };
}
async function onDrop(e: DragEvent, buildingId: string) {
  const drag = dragging.value;
  const at = dropAt.value;
  dragging.value = null;
  dropAt.value = null;
  if (!drag || !at || drag.buildingId !== buildingId || drag.floorId === at.floorId) return;
  e.preventDefault();
  const building = props.tree.flatMap((s) => s.buildings).find((b) => b.id === buildingId);
  if (!building) return;
  const ids = building.floors.map((f) => f.id).filter((id) => id !== drag.floorId);
  ids.splice(ids.indexOf(at.floorId) + (at.before ? 0 : 1), 0, drag.floorId);
  try {
    await api.put(`/plans/buildings/${buildingId}/floor-order`, { ids });
  } finally {
    emit('changed', {});
  }
}
function onDragEnd() {
  dragging.value = null;
  dropAt.value = null;
}

const empty = computed(() => props.tree.length === 0);
</script>

<template>
  <div class="plan-tree">
    <p v-if="empty" class="faint small empty">
      {{ canEdit ? 'Noch keine Pläne. Lege zuerst einen Standort an.' : 'Noch keine Pläne erfasst.' }}
    </p>
    <ul v-else class="tree" role="tree" aria-label="Standorte, Gebäude und Stockwerke">
      <li v-for="site in tree" :key="site.id" role="treeitem" :aria-expanded="!collapsed.has(site.id)">
        <div class="node site">
          <button class="twisty" type="button" :aria-expanded="!collapsed.has(site.id)" :aria-label="`${site.name} ${collapsed.has(site.id) ? 'aufklappen' : 'zuklappen'}`" @click="toggle(site.id)">
            <svg viewBox="0 0 12 12" aria-hidden="true"><path d="M3 4.5l3 3 3-3" fill="none" stroke="currentColor" stroke-width="1.6" /></svg>
          </button>
          <svg class="node-icon" viewBox="0 0 16 16" aria-hidden="true">
            <path d="M8 15s5-4.6 5-8.5A5 5 0 0 0 3 6.5C3 10.4 8 15 8 15z" fill="none" stroke="currentColor" stroke-width="1.4" />
            <circle cx="8" cy="6.5" r="1.8" fill="currentColor" />
          </svg>
          <button class="node-label" type="button" @click="toggle(site.id)">{{ site.name }}</button>
          <span class="count">{{ plural(site.buildings.length, 'Gebäude', 'Gebäude') }}</span>
          <span v-if="canEdit" class="actions">
            <button class="node-action" type="button" title="Gebäude hinzufügen" aria-label="Gebäude hinzufügen" @click="openName('add', 'building', site.id, null)">
              <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M8 3v10M3 8h10" stroke="currentColor" stroke-width="1.6" /></svg>
            </button>
            <button class="node-action" type="button" :title="`${site.name} umbenennen`" :aria-label="`${site.name} umbenennen`" @click="openName('rename', 'site', null, site.id, site.name)">
              <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M3 13l1-3.5L11 2.5l2.5 2.5-7 7zM9.5 4l2.5 2.5" fill="none" stroke="currentColor" stroke-width="1.3" /></svg>
            </button>
            <button class="node-action danger" type="button" :title="`${site.name} löschen`" :aria-label="`${site.name} löschen`" @click="askDelete('site', site.id)">
              <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M3 4.5h10M6.5 4.5V3h3v1.5M4.5 4.5l.7 9h5.6l.7-9" fill="none" stroke="currentColor" stroke-width="1.3" /></svg>
            </button>
          </span>
        </div>
        <ul v-if="!collapsed.has(site.id)" role="group">
          <li v-for="building in site.buildings" :key="building.id" role="treeitem" :aria-expanded="!collapsed.has(building.id)">
            <div class="node building">
              <button class="twisty" type="button" :aria-expanded="!collapsed.has(building.id)" :aria-label="`${building.name} ${collapsed.has(building.id) ? 'aufklappen' : 'zuklappen'}`" @click="toggle(building.id)">
                <svg viewBox="0 0 12 12" aria-hidden="true"><path d="M3 4.5l3 3 3-3" fill="none" stroke="currentColor" stroke-width="1.6" /></svg>
              </button>
              <svg class="node-icon" viewBox="0 0 16 16" aria-hidden="true">
                <path d="M3 14.5V2.5h7v12M10 6.5h3v8M1.5 14.5h13M5 5h2M5 8h2M5 11h2" fill="none" stroke="currentColor" stroke-width="1.3" />
              </svg>
              <button class="node-label" type="button" @click="toggle(building.id)">{{ building.name }}</button>
              <span class="count">{{ plural(building.floors.length, 'Stockwerk', 'Stockwerke') }}</span>
              <span v-if="canEdit" class="actions">
                <button
                  class="node-action"
                  type="button"
                  title="Stockwerk hinzufügen (zuoberst)"
                  aria-label="Stockwerk hinzufügen"
                  @click="addFloor(building.id, building.floors[0]?.name)"
                >
                  <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M8 3v10M3 8h10" stroke="currentColor" stroke-width="1.6" /></svg>
                </button>
                <button class="node-action" type="button" :title="`${building.name} umbenennen`" :aria-label="`${building.name} umbenennen`" @click="openName('rename', 'building', site.id, building.id, building.name)">
                  <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M3 13l1-3.5L11 2.5l2.5 2.5-7 7zM9.5 4l2.5 2.5" fill="none" stroke="currentColor" stroke-width="1.3" /></svg>
                </button>
                <button class="node-action danger" type="button" :title="`${building.name} löschen`" :aria-label="`${building.name} löschen`" @click="askDelete('building', building.id)">
                  <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M3 4.5h10M6.5 4.5V3h3v1.5M4.5 4.5l.7 9h5.6l.7-9" fill="none" stroke="currentColor" stroke-width="1.3" /></svg>
                </button>
              </span>
            </div>
            <ul v-if="!collapsed.has(building.id)" role="group">
              <li
                v-for="floor in building.floors"
                :key="floor.id"
                role="treeitem"
                :aria-selected="floor.id === selectedFloorId"
                @dragover="onDragOver($event, building.id, floor.id)"
                @drop="onDrop($event, building.id)"
              >
                <div
                  class="node floor"
                  :class="{
                    active: floor.id === selectedFloorId,
                    dragging: dragging?.floorId === floor.id,
                    'drop-before': dropAt?.floorId === floor.id && dropAt.before,
                    'drop-after': dropAt?.floorId === floor.id && !dropAt.before,
                  }"
                  :draggable="canEdit"
                  @dragstart="onDragStart($event, building.id, floor.id)"
                  @dragend="onDragEnd"
                >
                  <span v-if="canEdit" class="grip" title="Ziehen, um die Reihenfolge zu ändern" aria-hidden="true">⋮⋮</span>
                  <svg class="node-icon" viewBox="0 0 16 16" aria-hidden="true">
                    <path d="M2 5.5L8 2.5l6 3-6 3zM2 9l6 3 6-3" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linejoin="round" />
                  </svg>
                  <button class="node-label" type="button" :data-floor="floor.id" @click="emit('select', floor.id)">{{ floor.name }}</button>
                  <span class="count">{{ plural(floor.roomCount, 'Raum', 'Räume') }}</span>
                  <span v-if="canEdit" class="actions">
                    <button class="node-action" type="button" :title="`${floor.name} umbenennen`" :aria-label="`${floor.name} umbenennen`" @click="openName('rename', 'floor', building.id, floor.id, floor.name)">
                      <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M3 13l1-3.5L11 2.5l2.5 2.5-7 7zM9.5 4l2.5 2.5" fill="none" stroke="currentColor" stroke-width="1.3" /></svg>
                    </button>
                    <button class="node-action danger" type="button" :title="`${floor.name} löschen`" :aria-label="`${floor.name} löschen`" @click="askDelete('floor', floor.id)">
                      <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M3 4.5h10M6.5 4.5V3h3v1.5M4.5 4.5l.7 9h5.6l.7-9" fill="none" stroke="currentColor" stroke-width="1.3" /></svg>
                    </button>
                  </span>
                </div>
              </li>
              <li v-if="!building.floors.length" class="faint small none">Noch kein Stockwerk</li>
            </ul>
          </li>
          <li v-if="!site.buildings.length" class="faint small none">Noch kein Gebäude</li>
        </ul>
      </li>
    </ul>
    <div v-if="canEdit" class="tree-foot">
      <button class="link-btn" type="button" @click="openName('add', 'site', null, null)">+ Standort</button>
    </div>

    <ModalDialog
      v-if="nameDialog"
      :title="nameDialog.mode === 'add' ? `${KIND_LABELS[nameDialog.kind]} hinzufügen` : `${KIND_LABELS[nameDialog.kind]} umbenennen`"
      @close="nameDialog = null"
    >
      <form class="stack" @submit.prevent="submitName">
        <div class="field">
          <label for="plan-node-name">Name</label>
          <input id="plan-node-name" ref="nameInput" v-model="nameDialog.name" class="input" maxlength="60" />
          <span v-if="nameDialog.kind === 'floor' && nameDialog.mode === 'add'" class="hint">Das neue Stockwerk kommt zuoberst; die Reihenfolge lässt sich durch Ziehen ändern.</span>
        </div>
        <div v-if="nameError" class="error-box">{{ nameError }}</div>
      </form>
      <template #footer>
        <button class="btn" type="button" @click="nameDialog = null">Abbrechen</button>
        <button class="btn btn-primary" type="button" :disabled="busy" @click="submitName">
          {{ nameDialog.mode === 'add' ? 'Hinzufügen' : 'Umbenennen' }}
        </button>
      </template>
    </ModalDialog>

    <ModalDialog v-if="deleteDialog" :title="`${KIND_LABELS[deleteDialog.kind]} löschen`" @close="deleteDialog = null">
      <p class="delete-text">
        {{ KIND_LABELS[deleteDialog.kind] }} «{{ deleteDialog.name }}» löschen? Dabei fallen {{ deleteDialog.summary }} weg, samt Plänen.
        Das lässt sich nicht rückgängig machen.
      </p>
      <div v-if="deleteError" class="error-box">{{ deleteError }}</div>
      <template #footer>
        <button class="btn" type="button" @click="deleteDialog = null">Abbrechen</button>
        <button class="btn btn-danger" type="button" :disabled="busy" @click="confirmDelete">Löschen</button>
      </template>
    </ModalDialog>
  </div>
</template>

<style scoped>
.tree,
.tree ul {
  list-style: none;
  margin: 0;
  padding: 0;
}
.tree ul {
  margin-left: 11px;
  padding-left: 8px;
  border-left: 1px solid var(--border);
}
.node {
  display: flex;
  align-items: center;
  gap: 2px;
  min-height: 30px;
  border-radius: var(--radius-sm);
}
.node:hover {
  background: var(--surface-hover);
}
.twisty {
  width: 22px;
  height: 22px;
  border: 0;
  background: none;
  color: var(--text-muted);
  cursor: pointer;
  display: grid;
  place-items: center;
  border-radius: 4px;
  flex: none;
}
.twisty svg {
  width: 12px;
  height: 12px;
  transition: transform 0.12s;
}
.twisty[aria-expanded='false'] svg {
  transform: rotate(-90deg);
}
@media (prefers-reduced-motion: reduce) {
  .twisty svg {
    transition: none;
  }
}
.node-icon {
  width: 15px;
  height: 15px;
  color: var(--text-faint);
  flex: none;
}
.node-label {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  border: 0;
  background: none;
  text-align: left;
  padding: 4px;
  cursor: pointer;
  color: var(--text);
  font: inherit;
}
.site .node-label {
  font-weight: 600;
}
.building .node-label {
  font-weight: 500;
}
.node.floor {
  padding-left: 4px;
}
.node.floor.active {
  background: var(--accent-soft);
}
.node.floor.active .node-label {
  color: var(--accent);
  font-weight: 600;
}
.node.floor.dragging {
  opacity: 0.4;
}
.node.floor.drop-before {
  box-shadow: inset 0 2px 0 var(--accent);
}
.node.floor.drop-after {
  box-shadow: inset 0 -2px 0 var(--accent);
}
.count {
  font-size: 12px;
  color: var(--text-faint);
  font-variant-numeric: tabular-nums;
  padding-right: 4px;
  white-space: nowrap;
}
/* Knöpfe beim Darüberfahren oder mit dem Fokus; dann tritt die Anzahl zurück. Ohne Maus (Touch) immer sichtbar. */
.actions {
  display: none;
  align-items: center;
  flex: none;
}
.node:hover .actions,
.node:focus-within .actions {
  display: inline-flex;
}
.node:hover .count,
.node:focus-within .count {
  display: none;
}
@media (hover: none) {
  .actions {
    display: inline-flex;
  }
  .count {
    display: none;
  }
}
.node-action {
  width: 24px;
  height: 24px;
  border: 0;
  background: none;
  color: var(--text-faint);
  cursor: pointer;
  border-radius: 4px;
  display: grid;
  place-items: center;
  flex: none;
}
.node-action:hover,
.node-action:focus-visible {
  background: var(--surface-2);
  color: var(--text);
}
.node-action.danger:hover {
  color: var(--danger);
}
.node-action svg {
  width: 14px;
  height: 14px;
}
.grip {
  cursor: grab;
  color: var(--text-faint);
  width: 14px;
  flex: none;
  text-align: center;
  font-size: 11px;
  letter-spacing: -2px;
}
.none {
  padding: 4px 6px;
}
.empty {
  margin: 0;
}
.tree-foot {
  padding-top: 8px;
  margin-top: 6px;
  border-top: 1px solid var(--border);
}
.delete-text {
  margin: 0;
}
</style>
