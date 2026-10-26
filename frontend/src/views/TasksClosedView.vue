<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import ListFilters from '../components/ListFilters.vue';
import MineToggle from '../components/MineToggle.vue';
import PagedList from '../components/PagedList.vue';
import TasksNav from '../components/TasksNav.vue';
import { useListFilters, useListSort, useMineFilter } from '../composables';
import { useSession } from '../stores/session';
import type { ListFilterValues, ListSort } from '../list-filters';

const props = defineProps<{ view: 'tasks-done' | 'tasks-rejected' }>();
const session = useSession();
const mine = useMineFilter('tasks');

// Filter und Sortierung je Ansicht (erledigt, abgelehnt) gemerkt
const stored = {
  'tasks-done': { filters: useListFilters('tasks-done'), sort: useListSort('tasks-done') },
  'tasks-rejected': { filters: useListFilters('tasks-rejected'), sort: useListSort('tasks-rejected') },
};
const filters = computed<ListFilterValues>({
  get: () => stored[props.view].filters.value,
  set: (value) => (stored[props.view].filters.value = value),
});
const sort = ref<ListSort | null>(stored[props.view].sort.value);
watch(
  () => props.view,
  (view) => (sort.value = stored[view].sort.value),
);
watch(sort, (value) => (stored[props.view].sort.value = value));

// Status zur Wahl: unter «Erledigt» die abgeschlossenen ausser dem Ablehnen-Status (Filter erst ab zwei)
const statuses = computed(() =>
  props.view === 'tasks-done'
    ? session.statusesOf('task').filter((s) => s.closed && s.id !== session.targetId('task', 'reject'))
    : [],
);
</script>

<template>
  <div class="page">
    <div class="page-head">
      <h1>Aufgaben</h1>
      <TasksNav />
      <div class="spacer" />
      <MineToggle v-model="mine" />
    </div>
    <ListFilters v-model="filters" :mine="mine" :statuses="statuses" />
    <PagedList
      v-model:sort="sort"
      :view="view"
      :mine="mine"
      :filters="filters"
      show-closed
      :empty-text="view === 'tasks-done' ? 'Keine erledigten Aufgaben' : 'Keine abgelehnten Aufgaben'"
    />
  </div>
</template>
