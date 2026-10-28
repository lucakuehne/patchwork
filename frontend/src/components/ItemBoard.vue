<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue';
import draggable from 'vuedraggable';
import { api } from '../api';
import { useReloadAfterItemModal } from '../composables';
import { dueState, formatAge, formatDate, formatDay, initials, itemRef, plainPreview } from '../format';
import { listParams, type ListFilterValues } from '../list-filters';
import { itemHref, opensInBrowser, useOpenItem } from '../open-item';
import { isCompleting } from '../status-flow';
import { manualStatusChoices, moveItem } from '../status-move';
import { useSession } from '../stores/session';
import { useToast } from '../stores/toast';
import type { ItemSummary, ItemType } from '../types';
import ChecklistProgress from './ChecklistProgress.vue';

/**
 * Board eines Typs: je Status eine Spalte (ohne den Ablehnen-Status), abgeschlossene zeigen nur die letzten 14 Tage.
 * Aufgaben: Reihenfolge von Hand (ziehen innerhalb und zwischen Spalten). Störungen: nach Priorität, dann Alter;
 * Ziehen wechselt nur den Status (Entscheid vom 27.10.2026). Der Status-Filter gilt hier nicht, die Spalten sind es.
 */
const props = defineProps<{ type: ItemType; mine: boolean; filters: ListFilterValues }>();
/** «+» einer offenen Spalte: neuen Vorgang in diesem Status erfassen */
const emit = defineEmits<{ create: [statusId: string] }>();

const session = useSession();
const toast = useToast();
const openItem = useOpenItem();
const columns = ref<Record<string, ItemSummary[]>>({});
const loading = ref(true);
const manualOrder = computed(() => props.type === 'task');
const view = computed(() => (props.type === 'task' ? 'board' : 'incidents-board'));
const typeLabel = computed(() => (props.type === 'task' ? 'Aufgabe' : 'Störung'));

function dueTitle(dueDate: string, closed: boolean) {
  const state = dueState(dueDate, closed);
  const suffix = state === 'overdue' ? ' (überfällig)' : state === 'today' ? ' (heute)' : '';
  return `Fällig am ${formatDay(dueDate)}${suffix}`;
}
/** Karte, die gerade gezogen wird: Spalten ausserhalb des Ablaufs sind gesperrt */
const dragging = ref<ItemSummary | null>(null);

const blocked = (statusId: string) =>
  !!dragging.value && !session.canMove(props.type, dragging.value.status?.id ?? null, statusId);

function onStart(statusId: string, event: { oldIndex: number }) {
  dragging.value = columns.value[statusId]?.[event.oldIndex] ?? null;
}

/** Ablegen nur in Spalten, in die der Ablauf den Wechsel erlaubt */
function canDrop(event: { draggedContext: { element: ItemSummary }; to: HTMLElement }) {
  const toId = event.to.dataset.statusId;
  return !toId || session.canMove(props.type, event.draggedContext.element.status?.id ?? null, toId);
}

const statuses = computed(() =>
  manualStatusChoices(session.statusesOf(props.type), session.statusTargets[props.type], null),
);

async function load() {
  try {
    const filters = { ...props.filters, status: '' };
    const params = new URLSearchParams({ view: view.value, mine: props.mine ? '1' : '0', ...listParams(filters, null) });
    const { items } = await api.get<{ items: ItemSummary[] }>(`/items?${params}`);
    const next: Record<string, ItemSummary[]> = {};
    for (const s of statuses.value) next[s.id] = [];
    for (const item of items) if (item.status) (next[item.status.id] ??= []).push(item);
    columns.value = next;
  } catch (err) {
    toast.error(err);
  } finally {
    loading.value = false;
  }
}
watch([() => props.type, () => props.mine, statuses, () => JSON.stringify(props.filters)], load, { immediate: true });
useReloadAfterItemModal(load);
defineExpose({ reload: load });

interface ChangeEvent {
  added?: { element: ItemSummary; newIndex: number };
  moved?: { element: ItemSummary; newIndex: number };
}

async function onChange(statusId: string, event: ChangeEvent) {
  const change = event.added ?? event.moved;
  if (!change) return; // «removed» wird in der Zielspalte als «added» behandelt
  await nextTick();
  // Aufgaben: Platz zwischen den Nachbarn; Störungen: nur der Status, die Reihenfolge ergibt sich
  const list = columns.value[statusId] ?? [];
  const index = list.findIndex((i) => i.id === change.element.id);
  const neighbours = manualOrder.value
    ? { beforeId: list[index - 1]?.id ?? null, afterId: list[index + 1]?.id ?? null }
    : {};
  try {
    // Bei offenen Checklisten-Punkten fragt moveItem nach; bei Abbruch springt die Karte zurück
    const moved = await moveItem(change.element.number, { statusId, ...neighbours });
    if (!moved) {
      await load();
      return;
    }
    const status = event.added && statuses.value.find((s) => s.id === statusId);
    if (status) {
      // Toast wie die Mail «Erledigt»: aus einem offenen in einen abgeschlossenen Status
      const from = change.element.status;
      change.element.status = { id: status.id, label: status.label, closed: status.closed, color: status.color };
      if (isCompleting(session.statusTargets[props.type], from, status)) {
        toast.success(`${itemRef(change.element.number)} ${props.type === 'task' ? 'erledigt' : 'gelöst'}`);
      }
    }
    if (!manualOrder.value) await load();
    void session.refreshCounts();
  } catch (err) {
    toast.error(err);
    await load();
  }
}

// Klick öffnet je nach Einstellung als Seite oder Fenster; Ctrl+Klick bzw. mittlere Taste in einem neuen Tab
function open(item: ItemSummary, event: MouseEvent) {
  if (opensInBrowser(event)) window.open(itemHref(item.number), '_blank');
  else openItem(item.number, props.type);
}
</script>

<template>
  <div v-if="!loading" class="board">
    <section
      v-for="status in statuses"
      :key="status.id"
      class="column"
      :class="{ blocked: blocked(status.id) }"
      :style="{ '--column-tint': `var(--st-${status.color}-bg)` }"
      :title="blocked(status.id) ? 'Dieser Wechsel ist im Ablauf nicht vorgesehen' : undefined"
    >
      <header class="column-head">
        <span class="badge" :class="`st-${status.color}`">{{ status.label }}</span>
        <span class="faint">{{ columns[status.id]?.length ?? 0 }}</span>
        <span v-if="status.closed" class="faint hint">letzte 14 Tage</span>
        <button
          v-else
          class="btn btn-sm btn-ghost add"
          type="button"
          :title="`${typeLabel} in «${status.label}» erstellen`"
          :aria-label="`${typeLabel} in «${status.label}» erstellen`"
          @click="emit('create', status.id)"
        >
          +
        </button>
      </header>
      <draggable
        v-model="columns[status.id]"
        item-key="id"
        :group="`board-${type}`"
        :sort="manualOrder"
        class="cards"
        ghost-class="ghost"
        :animation="120"
        :component-data="{ 'data-status-id': status.id }"
        :move="canDrop"
        @start="onStart(status.id, $event)"
        @end="dragging = null"
        @change="onChange(status.id, $event)"
      >
        <template #item="{ element }">
          <article
            class="board-card card"
            :class="{ done: status.closed }"
            @click="open(element, $event)"
            @auxclick.middle.prevent="open(element, $event)"
          >
            <!-- Oben Nummer, Priorität und ganz rechts das Alter; unter dem Titel die Fälligkeit; unten Melder,
                 Beschreibung, Kommentare und Zuständig -->
            <div class="card-top">
              <span class="mono faint number">{{ itemRef(element.number) }}</span>
              <span class="spacer" />
              <span v-if="element.priority === 'high'" class="prio prio-high">Hoch</span>
              <span v-else-if="element.priority === 'low'" class="prio prio-low">Niedrig</span>
              <span class="age faint" :title="`Erstellt am ${formatDate(element.createdAt)}`">{{ formatAge(element.createdAt) }}</span>
            </div>
            <div class="card-title">{{ element.title }}</div>
            <div v-if="element.dueDate" class="card-due">
              <span
                class="badge due"
                :class="`due-${dueState(element.dueDate, status.closed)}`"
                :title="dueTitle(element.dueDate, status.closed)"
              >
                <svg class="due-icon" viewBox="0 0 16 16" aria-hidden="true">
                  <rect x="2" y="3" width="12" height="11" rx="1.5" />
                  <path d="M2 6.5h12M5.5 1.8v2.6M10.5 1.8v2.6" />
                </svg>
                {{ formatDay(element.dueDate) }}
              </span>
            </div>
            <!-- Fortschritt der Checklisten über die ganze Breite der Karte -->
            <ChecklistProgress v-if="element.checklist" fill :done="element.checklist.done" :total="element.checklist.total" />
            <div class="card-foot">
              <span class="reporter faint" :title="element.reporter.email">{{ element.reporter.name }}</span>
              <span class="spacer" />
              <span
                v-if="element.descriptionPreview"
                class="meta-icon"
                :title="plainPreview(element.descriptionPreview)"
                aria-label="Hat eine Beschreibung"
              >
                <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M2.5 4h11M2.5 7h11M2.5 10h11M2.5 13h7" /></svg>
              </span>
              <span
                v-if="element.commentCount"
                class="meta-icon"
                :title="`${element.commentCount} ${element.commentCount === 1 ? 'Kommentar' : 'Kommentare'}`"
              >
                <svg viewBox="0 0 16 16" aria-hidden="true">
                  <path d="M2.5 3.5h11v7.5h-6l-3.2 2.6v-2.6H2.5z" />
                </svg>
                {{ element.commentCount }}
              </span>
              <span v-if="element.assignee" class="avatar" :title="element.assignee.name">
                {{ initials(element.assignee.name) }}
              </span>
            </div>
          </article>
        </template>
      </draggable>
    </section>
  </div>
</template>

<style scoped>
.board {
  display: grid;
  grid-auto-flow: column;
  grid-auto-columns: minmax(260px, 1fr);
  gap: 14px;
  overflow-x: auto;
  padding-bottom: 8px;
  align-items: start;
}
.column {
  /* ganz leicht in der Farbe des Status */
  background: color-mix(in srgb, var(--column-tint, var(--surface-2)) 55%, var(--surface-2));
  border-radius: var(--radius);
  padding: 10px;
  min-height: 200px;
  transition: opacity 0.12s;
}
.column.blocked {
  opacity: 0.45;
}
.column-head {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 10px;
}
.hint {
  font-size: 12px;
  margin-left: auto;
}
.add {
  margin-left: auto;
  padding: 0 8px;
  font-size: 16px;
  line-height: 1;
}
.meta-icon {
  display: inline-flex;
  align-items: center;
  gap: 3px;
  font-size: 12px;
  color: var(--text-muted);
}
.meta-icon svg {
  width: 14px;
  height: 14px;
  fill: none;
  stroke: currentColor;
  stroke-width: 1.4;
  stroke-linecap: round;
  stroke-linejoin: round;
}
.due {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  font-size: 12px;
}
.due-icon {
  width: 12px;
  height: 12px;
  fill: none;
  stroke: currentColor;
  stroke-width: 1.4;
  stroke-linecap: round;
}
.due-overdue {
  background: var(--danger-soft);
  color: var(--danger);
}
.due-today {
  background: var(--warning-soft);
  color: var(--warning);
}
.due-later,
.due-done {
  background: var(--surface-2);
  color: var(--text-muted);
}
.cards {
  display: flex;
  flex-direction: column;
  gap: 8px;
  min-height: 120px;
}
.board-card {
  padding: 10px 12px;
  cursor: grab;
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.board-card:hover {
  border-color: var(--border-strong);
}
.board-card.done .card-title {
  color: var(--text-muted);
}
/* Links die Nummer, rechts Priorität und ganz rechts das Alter; passt auch in der schmalsten Spalte (260 px) auf eine
   Zeile, die Nummer bricht nie beim Bindestrich um */
.card-top {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 12px;
}
.number,
.age {
  flex-shrink: 0;
  white-space: nowrap;
}
.card-due {
  display: flex;
}
.card-title {
  font-weight: 500;
  overflow-wrap: anywhere;
}
.card-foot {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 12px;
}
/* Lange Namen kürzen, damit Symbole und Zuständig in der Zeile bleiben */
.card-foot > * {
  flex-shrink: 0;
}
.card-foot > .reporter {
  flex-shrink: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.ghost {
  opacity: 0.4;
}
</style>
