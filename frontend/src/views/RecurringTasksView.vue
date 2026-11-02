<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { api } from '../api';
import RecurringTaskDialog from '../components/RecurringTaskDialog.vue';
import TasksNav from '../components/TasksNav.vue';
import { itemRef } from '../format';
import type { ItemKey } from '../item-ref';
import { itemHref } from '../open-item';
import { dayWithWeekday, describeRecurrence } from '../recurrence-text';
import { useSession } from '../stores/session';
import { useToast } from '../stores/toast';
import type { RecurringTask } from '../types';

/**
 * Wiederkehrende Aufgaben (seit 02.11.2026): Vorlagen, aus denen Patchwork nach ihrem Rhythmus Aufgaben anlegt.
 * «?id=…» öffnet eine davon (Link aus einer angelegten Aufgabe).
 */
const route = useRoute();
const router = useRouter();
const session = useSession();
const toast = useToast();
const tasks = ref<RecurringTask[]>([]);
const loading = ref(true);
/** Offener Dialog: eine bestehende, «new» für eine neue, null = keiner */
const open = ref<RecurringTask | 'new' | null>(null);

async function load() {
  try {
    tasks.value = await api.get<RecurringTask[]>('/recurring-tasks');
  } catch (err) {
    toast.error(err);
  } finally {
    loading.value = false;
  }
}

onMounted(async () => {
  await load();
  openFromQuery();
});
watch(() => route.query.id, openFromQuery);
function openFromQuery() {
  const id = route.query.id;
  if (typeof id !== 'string') return;
  const task = tasks.value.find((t) => t.id === id);
  if (task) open.value = task;
  else toast.error('Diese wiederkehrende Aufgabe gibt es nicht mehr.');
}

function close() {
  open.value = null;
  if (route.query.id) void router.replace({ query: {} });
}
async function onSaved() {
  close();
  await load();
}
async function onCreated(item: ItemKey) {
  close();
  toast.success(`${itemRef(item)} angelegt`, { text: 'Öffnen', to: itemHref(item), item: { ...item, type: 'task' } });
  await load();
  void session.refreshCounts();
}

const assigneeName = (id: string | null) => (id ? (session.staff.find((u) => u.id === id)?.name ?? '–') : '–');
const rows = computed(() =>
  tasks.value.map((t) => ({
    task: t,
    rhythm: describeRecurrence(t.schedule, t.weekend),
    next: t.next ? dayWithWeekday(t.next.due) : t.endDate ? 'beendet' : '–',
  })),
);
</script>

<template>
  <div class="page">
    <div class="page-head">
      <h1>Aufgaben</h1>
      <TasksNav />
      <div class="spacer" />
      <button class="btn" type="button" @click="open = 'new'">+ Wiederkehrende Aufgabe</button>
    </div>
    <p class="muted intro">
      Patchwork legt die Aufgaben nach dem Rhythmus an, jeweils am Tag der Fälligkeit (oder mit Vorlauf früher) um 06:00 Uhr. Ist die
      vorherige noch offen, entsteht die nächste trotzdem.
    </p>
    <div v-if="!loading" class="card">
      <div v-if="!rows.length" class="empty">Noch keine wiederkehrenden Aufgaben.</div>
      <div v-else class="table-wrap">
        <table class="table">
          <thead>
            <tr>
              <th>Titel</th>
              <th>Rhythmus</th>
              <th>Nächste Fälligkeit</th>
              <th>Zuständig</th>
              <th />
            </tr>
          </thead>
          <tbody>
            <tr v-for="row in rows" :key="row.task.id" class="clickable" :class="{ paused: !row.task.active }" @click="open = row.task">
              <td class="title-cell">{{ row.task.title }}</td>
              <td>{{ row.rhythm }}</td>
              <td class="nowrap">{{ row.next }}</td>
              <td>{{ assigneeName(row.task.assigneeId) }}</td>
              <td><span v-if="!row.task.active" class="badge">pausiert</span></td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  </div>

  <RecurringTaskDialog
    v-if="open"
    :task="open === 'new' ? null : open"
    @close="close"
    @saved="onSaved"
    @created="onCreated"
  />
</template>

<style scoped>
.intro {
  margin: 0 0 12px;
}
.nowrap {
  white-space: nowrap;
}
.paused td {
  color: var(--text-muted);
}
</style>
