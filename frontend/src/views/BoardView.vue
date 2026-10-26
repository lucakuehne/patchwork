<script setup lang="ts">
import { computed, defineAsyncComponent, nextTick, ref, watch } from 'vue';
import { useRouter } from 'vue-router';
import draggable from 'vuedraggable';
import { api } from '../api';
import ChecklistProgress from '../components/ChecklistProgress.vue';
import ListFilters from '../components/ListFilters.vue';
import MineToggle from '../components/MineToggle.vue';
import { isCompleting } from '../status-flow';
import { manualStatusChoices, moveItem } from '../status-move';
import TasksNav from '../components/TasksNav.vue';
import { useListFilters, useMineFilter } from '../composables';
import { listParams } from '../list-filters';
import { dueState, formatAge, formatDay, initials, itemRef, plainPreview } from '../format';
import { useSession } from '../stores/session';
import { useToast } from '../stores/toast';
import type { ItemSummary } from '../types';

const NewItemDialog = defineAsyncComponent(() => import('../components/NewItemDialog.vue'));

const session = useSession();
const toast = useToast();
const router = useRouter();
const mine = useMineFilter('tasks');
const filters = useListFilters('board');
const columns = ref<Record<string, ItemSummary[]>>({});
const loading = ref(true);
const newOpen = ref(false);
/** Status aus dem «+» einer Spalte; über «+ Aufgabe» keiner (Start-Status) */
const newStatusId = ref<string | undefined>();

function createNew() {
  newStatusId.value = undefined;
  newOpen.value = true;
}

function createIn(statusId: string) {
  newStatusId.value = statusId;
  newOpen.value = true;
}

function dueTitle(dueDate: string, closed: boolean) {
  const state = dueState(dueDate, closed);
  const suffix = state === 'overdue' ? ' (überfällig)' : state === 'today' ? ' (heute)' : '';
  return `Fällig am ${formatDay(dueDate)}${suffix}`;
}
/** Karte, die gerade gezogen wird: Spalten ausserhalb des Ablaufs sind gesperrt */
const dragging = ref<ItemSummary | null>(null);

const blocked = (statusId: string) =>
  !!dragging.value && !session.canMove('task', dragging.value.status?.id ?? null, statusId);

function onStart(statusId: string, event: { oldIndex: number }) {
  dragging.value = columns.value[statusId]?.[event.oldIndex] ?? null;
}

/** Ablegen nur in Spalten, in die der Ablauf den Wechsel erlaubt */
function canDrop(event: { draggedContext: { element: ItemSummary }; to: HTMLElement }) {
  const toId = event.to.dataset.statusId;
  return !toId || session.canMove('task', event.draggedContext.element.status?.id ?? null, toId);
}

// Spalten: alle Status der Aufgaben ausser dem Ablehnen-Status; abgeschlossene zeigen nur die letzten 14 Tage
const statuses = computed(() => manualStatusChoices(session.statusesOf('task'), session.statusTargets.task, null));

async function load() {
  try {
    const params = new URLSearchParams({ view: 'board', mine: mine.value ? '1' : '0', ...listParams(filters.value, null) });
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
watch([mine, statuses, () => JSON.stringify(filters.value)], load, { immediate: true });

interface ChangeEvent {
  added?: { element: ItemSummary; newIndex: number };
  moved?: { element: ItemSummary; newIndex: number };
}

async function onChange(statusId: string, event: ChangeEvent) {
  const change = event.added ?? event.moved;
  if (!change) return; // «removed» wird in der Zielspalte als «added» behandelt
  await nextTick();
  const list = columns.value[statusId] ?? [];
  const index = list.findIndex((i) => i.id === change.element.id);
  const before = list[index - 1]?.id ?? null;
  const after = list[index + 1]?.id ?? null;
  try {
    // Bei offenen Checklisten-Punkten fragt moveItem nach; bei Abbruch springt die Karte zurück
    const moved = await moveItem(change.element.number, { statusId, beforeId: before, afterId: after });
    if (!moved) {
      await load();
      return;
    }
    const status = event.added && statuses.value.find((s) => s.id === statusId);
    if (status) {
      // Toast wie die Mail «Erledigt»: aus einem offenen in einen abgeschlossenen Status
      const from = change.element.status;
      change.element.status = { id: status.id, label: status.label, closed: status.closed, color: status.color };
      if (isCompleting(session.statusTargets.task, from, status)) toast.success(`${itemRef(change.element.number)} erledigt`);
    }
    void session.refreshCounts();
  } catch (err) {
    toast.error(err);
    await load();
  }
}

function open(item: ItemSummary) {
  void router.push({ name: 'item', params: { number: item.number } });
}

// Die neue Aufgabe erscheint in ihrer Spalte; geöffnet wird sie über die Meldung
function onCreated(number: number) {
  newOpen.value = false;
  toast.success(`${itemRef(number)} erstellt`, { text: 'Öffnen', to: `/v/${number}` });
  void load();
  void session.refreshCounts();
}
</script>

<template>
  <div class="page board-page">
    <div class="page-head">
      <h1>Aufgaben</h1>
      <TasksNav />
      <div class="spacer" />
      <MineToggle v-model="mine" />
      <button class="btn" type="button" @click="createNew">+ Aufgabe</button>
    </div>
    <ListFilters v-model="filters" :mine="mine" />

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
            :title="`Aufgabe in «${status.label}» erstellen`"
            :aria-label="`Aufgabe in «${status.label}» erstellen`"
            @click="createIn(status.id)"
          >
            +
          </button>
        </header>
        <draggable
          v-model="columns[status.id]"
          item-key="id"
          group="board"
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
            <article class="task card" :class="{ done: status.closed }" @click="open(element)">
              <div class="task-top">
                <span class="mono faint">{{ itemRef(element.number) }}</span>
                <span v-if="element.priority === 'high'" class="prio prio-high">Hoch</span>
                <span v-else-if="element.priority === 'low'" class="prio prio-low">Niedrig</span>
              </div>
              <div class="task-title">{{ element.title }}</div>
              <div v-if="element.dueDate || element.descriptionPreview || element.commentCount" class="task-meta">
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
                <span
                  v-if="element.dueDate"
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
              <div class="task-foot">
                <span class="faint" :title="element.reporter.email">{{ element.reporter.name }}</span>
                <span class="spacer" />
                <span class="faint">{{ formatAge(element.createdAt) }}</span>
                <span v-if="element.assignee" class="avatar" :title="element.assignee.name">
                  {{ initials(element.assignee.name) }}
                </span>
              </div>
            </article>
          </template>
        </draggable>
      </section>
    </div>
  </div>

  <NewItemDialog
    v-if="newOpen"
    fixed-type="task"
    :initial-status-id="newStatusId"
    @close="newOpen = false"
    @created="onCreated"
  />
</template>

<style scoped>
.board-page {
  max-width: none;
}
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
.task-meta {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 6px 10px;
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
.task {
  padding: 10px 12px;
  cursor: grab;
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.task:hover {
  border-color: var(--border-strong);
}
.task.done .task-title {
  color: var(--text-muted);
}
.task-top {
  display: flex;
  justify-content: space-between;
  font-size: 12px;
}
.task-title {
  font-weight: 500;
  overflow-wrap: anywhere;
}
.task-foot {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 12px;
}
.ghost {
  opacity: 0.4;
}
</style>
