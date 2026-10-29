<script setup lang="ts">
import { computed, defineAsyncComponent, ref, watch } from 'vue';
import { api } from '../api';
import ItemBoard from '../components/ItemBoard.vue';
import ItemTable from '../components/ItemTable.vue';
import LayoutToggle from '../components/LayoutToggle.vue';
import ListFilters from '../components/ListFilters.vue';
import MineToggle from '../components/MineToggle.vue';
import TasksNav from '../components/TasksNav.vue';
import { useListFilters, useListSort, useMineFilter, useReloadAfterItemModal } from '../composables';
import { itemRef } from '../format';
import type { ItemKey } from '../item-ref';
import { listParams } from '../list-filters';
import { itemHref } from '../open-item';
import { useSession } from '../stores/session';
import { useToast } from '../stores/toast';
import type { ItemSummary } from '../types';

const NewItemDialog = defineAsyncComponent(() => import('../components/NewItemDialog.vue'));

/**
 * Offene Aufgaben als Board (Standard) oder Liste, pro Benutzer gespeichert. Die Liste ist nach Status sortiert, dann
 * wie im Board; das Board zeigt dazu die abgeschlossenen der letzten 14 Tage.
 */
const session = useSession();
const toast = useToast();
const mine = useMineFilter('tasks');
// Filter für Board und Liste gemeinsam; den Status gibt es nur in der Liste (im Board sind es die Spalten)
const filters = useListFilters('board');
const sort = useListSort('tasks');
const asBoard = computed(() => session.preferences.layout.tasks === 'board');
const openStatuses = computed(() => session.statusesOf('task').filter((s) => !s.closed));

const board = ref<InstanceType<typeof ItemBoard> | null>(null);
const items = ref<ItemSummary[]>([]);
const loading = ref(true);

async function load() {
  if (asBoard.value) return;
  try {
    const params = new URLSearchParams({ view: 'tasks', mine: mine.value ? '1' : '0', ...listParams(filters.value, sort.value) });
    items.value = (await api.get<{ items: ItemSummary[] }>(`/items?${params}`)).items;
  } catch (err) {
    toast.error(err);
  } finally {
    loading.value = false;
  }
}
watch([asBoard, mine, () => JSON.stringify(filters.value), () => JSON.stringify(sort.value)], load, { immediate: true });
useReloadAfterItemModal(load);

const newOpen = ref(false);
/** Status aus dem «+» einer Spalte; über «+ Aufgabe» keiner (Start-Status) */
const newStatusId = ref<string | undefined>();
function createIn(statusId?: string) {
  newStatusId.value = statusId;
  newOpen.value = true;
}

// Die neue Aufgabe erscheint in ihrer Spalte bzw. der Liste; geöffnet wird sie über die Meldung
function onCreated(created: ItemKey) {
  newOpen.value = false;
  toast.success(`${itemRef(created)} erstellt`, { text: 'Öffnen', to: itemHref(created), item: { ...created, type: 'task' } });
  if (asBoard.value) void board.value?.reload();
  else void load();
  void session.refreshCounts();
}
</script>

<template>
  <div class="page" :class="{ 'board-page': asBoard }">
    <div class="page-head">
      <h1>Aufgaben</h1>
      <TasksNav />
      <LayoutToggle kind="tasks" />
      <div class="spacer" />
      <MineToggle v-model="mine" />
      <button class="btn" type="button" @click="createIn()">+ Aufgabe</button>
    </div>
    <ListFilters v-model="filters" :mine="mine" :statuses="asBoard ? undefined : openStatuses" />
    <ItemBoard v-if="asBoard" ref="board" type="task" :mine="mine" :filters="filters" @create="createIn" />
    <ItemTable
      v-else-if="!loading"
      v-model:sort="sort"
      :items="items"
      show-status
      empty-text="Keine offenen Aufgaben"
    />
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
</style>
