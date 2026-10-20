<script setup lang="ts">
import { computed, defineAsyncComponent, nextTick, ref, watch } from 'vue';
import { useRouter } from 'vue-router';
import draggable from 'vuedraggable';
import { api } from '../api';
import MineToggle from '../components/MineToggle.vue';
import { isCompleting } from '../status-flow';
import { manualStatusChoices, moveItem } from '../status-move';
import TasksNav from '../components/TasksNav.vue';
import { useMineFilter } from '../composables';
import { formatAge, initials, itemRef } from '../format';
import { useSession } from '../stores/session';
import { useToast } from '../stores/toast';
import type { ItemSummary } from '../types';

const NewItemDialog = defineAsyncComponent(() => import('../components/NewItemDialog.vue'));

const session = useSession();
const toast = useToast();
const router = useRouter();
const mine = useMineFilter('tasks');
const columns = ref<Record<string, ItemSummary[]>>({});
const loading = ref(true);
const newOpen = ref(false);
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
    const { items } = await api.get<{ items: ItemSummary[] }>(`/items?view=board&mine=${mine.value ? 1 : 0}`);
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
watch([mine, statuses], load, { immediate: true });

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

function onCreated(number: number) {
  newOpen.value = false;
  void router.push({ name: 'item', params: { number } });
}
</script>

<template>
  <div class="page board-page">
    <div class="page-head">
      <h1>Aufgaben</h1>
      <TasksNav />
      <div class="spacer" />
      <MineToggle v-model="mine" />
      <button class="btn" type="button" @click="newOpen = true">+ Aufgabe</button>
    </div>

    <div v-if="!loading" class="board">
      <section
        v-for="status in statuses"
        :key="status.id"
        class="column"
        :class="{ blocked: blocked(status.id) }"
        :title="blocked(status.id) ? 'Dieser Wechsel ist im Ablauf nicht vorgesehen' : undefined"
      >
        <header class="column-head">
          <span class="badge" :class="`st-${status.color}`">{{ status.label }}</span>
          <span class="faint">{{ columns[status.id]?.length ?? 0 }}</span>
          <span v-if="status.closed" class="faint hint">letzte 14 Tage</span>
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
              <div class="task-foot">
                <span
                  v-if="element.checklist"
                  class="badge progress-badge board-progress"
                  :class="{ complete: element.checklist.done === element.checklist.total }"
                  :title="`Checklisten: ${element.checklist.done} von ${element.checklist.total} erledigt`"
                >
                  ☑ {{ element.checklist.done }}/{{ element.checklist.total }}
                </span>
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

  <NewItemDialog v-if="newOpen" fixed-type="task" @close="newOpen = false" @created="onCreated" />
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
  background: var(--surface-2);
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
.board-progress {
  margin-left: 0;
}
</style>
