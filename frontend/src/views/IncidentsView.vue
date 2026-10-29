<script setup lang="ts">
import { computed, defineAsyncComponent, ref, watch } from 'vue';
import { api } from '../api';
import ItemBoard from '../components/ItemBoard.vue';
import ItemTable from '../components/ItemTable.vue';
import LayoutToggle from '../components/LayoutToggle.vue';
import ListFilters from '../components/ListFilters.vue';
import MineToggle from '../components/MineToggle.vue';
import PagedList from '../components/PagedList.vue';
import { useListFilters, useListSort, useMineFilter, useReloadAfterItemModal } from '../composables';
import type { ItemKey } from '../item-ref';
import { listParams } from '../list-filters';
import { useOpenItem } from '../open-item';
import { useSession } from '../stores/session';
import { useToast } from '../stores/toast';
import type { ItemSummary } from '../types';

const NewItemDialog = defineAsyncComponent(() => import('../components/NewItemDialog.vue'));

/**
 * Störungen: offene als Liste (Standard) oder Board, pro Benutzer gespeichert; gelöste immer als Liste. Das Board zeigt
 * dazu die gelösten der letzten 14 Tage, nach Priorität und Alter.
 */
const props = defineProps<{ closed: boolean }>();
const session = useSession();
const toast = useToast();
const openItem = useOpenItem();
const asBoard = computed(() => !props.closed && session.preferences.layout.incidents === 'board');

const newOpen = ref(false);
/** Status aus dem «+» einer Spalte des Boards; sonst keiner (Start-Status) */
const newStatusId = ref<string | undefined>();
function createIn(statusId?: string) {
  newStatusId.value = statusId;
  newOpen.value = true;
}
function onCreated(created: ItemKey) {
  newOpen.value = false;
  openItem(created, 'incident');
}
const mine = useMineFilter('incidents');
const items = ref<ItemSummary[]>([]);
const loading = ref(true);

// Filter und Sortierung je Ansicht (offen, gelöst) gemerkt; Status zur Wahl nur die der Ansicht, im Board keiner
const openFilters = useListFilters('incidents');
const openSort = useListSort('incidents');
const closedFilters = useListFilters('incidents-closed');
const closedSort = useListSort('incidents-closed');
const filters = computed({
  get: () => (props.closed ? closedFilters.value : openFilters.value),
  set: (value) => (props.closed ? (closedFilters.value = value) : (openFilters.value = value)),
});
const statuses = computed(() =>
  asBoard.value ? undefined : session.statusesOf('incident').filter((s) => s.closed === props.closed),
);

async function load() {
  if (props.closed || asBoard.value) return;
  try {
    const params = new URLSearchParams({
      view: 'incidents',
      mine: mine.value ? '1' : '0',
      ...listParams(openFilters.value, openSort.value),
    });
    items.value = (await api.get<{ items: ItemSummary[] }>(`/items?${params}`)).items;
  } catch (err) {
    toast.error(err);
  } finally {
    loading.value = false;
  }
}
watch(
  [mine, () => props.closed, asBoard, () => JSON.stringify(openFilters.value), () => JSON.stringify(openSort.value)],
  load,
  { immediate: true },
);
useReloadAfterItemModal(load);
</script>

<template>
  <div class="page" :class="{ 'board-page': asBoard }">
    <div class="page-head">
      <h1>Störungen</h1>
      <div class="segmented">
        <RouterLink to="/incidents">Offen</RouterLink>
        <RouterLink to="/incidents/resolved">Gelöst</RouterLink>
      </div>
      <LayoutToggle v-if="!closed" kind="incidents" />
      <div class="spacer" />
      <MineToggle v-model="mine" />
      <button class="btn" type="button" @click="createIn()">+ Störung</button>
    </div>
    <ListFilters v-model="filters" :mine="mine" :statuses="statuses" />
    <PagedList
      v-if="closed"
      v-model:sort="closedSort"
      view="incidents-closed"
      :mine="mine"
      :filters="closedFilters"
      show-status
      show-closed
      empty-text="Keine gelösten Störungen"
    />
    <ItemBoard v-else-if="asBoard" type="incident" :mine="mine" :filters="openFilters" @create="createIn" />
    <ItemTable v-else-if="!loading" v-model:sort="openSort" :items="items" show-status empty-text="Keine offenen Störungen" />
  </div>

  <NewItemDialog
    v-if="newOpen"
    fixed-type="incident"
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
