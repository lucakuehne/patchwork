<script setup lang="ts">
import { computed, defineAsyncComponent, ref, watch } from 'vue';
import { useRouter } from 'vue-router';
import { api } from '../api';
import ItemTable from '../components/ItemTable.vue';
import ListFilters from '../components/ListFilters.vue';
import MineToggle from '../components/MineToggle.vue';
import PagedList from '../components/PagedList.vue';
import { useListFilters, useListSort, useMineFilter } from '../composables';
import { listParams } from '../list-filters';
import { useSession } from '../stores/session';
import { useToast } from '../stores/toast';
import type { ItemSummary } from '../types';

const NewItemDialog = defineAsyncComponent(() => import('../components/NewItemDialog.vue'));

const props = defineProps<{ closed: boolean }>();
const session = useSession();
const toast = useToast();
const router = useRouter();
const newOpen = ref(false);

function onCreated(number: number) {
  newOpen.value = false;
  void router.push({ name: 'item', params: { number } });
}
const mine = useMineFilter('incidents');
const items = ref<ItemSummary[]>([]);
const loading = ref(true);

// Filter und Sortierung je Ansicht (offen, gelöst) gemerkt; Status zur Wahl nur die der Ansicht
const openFilters = useListFilters('incidents');
const openSort = useListSort('incidents');
const closedFilters = useListFilters('incidents-closed');
const closedSort = useListSort('incidents-closed');
const filters = computed({
  get: () => (props.closed ? closedFilters.value : openFilters.value),
  set: (value) => (props.closed ? (closedFilters.value = value) : (openFilters.value = value)),
});
const statuses = computed(() => session.statusesOf('incident').filter((s) => s.closed === props.closed));

async function load() {
  if (props.closed) return;
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
watch([mine, () => props.closed, () => JSON.stringify(openFilters.value), () => JSON.stringify(openSort.value)], load, {
  immediate: true,
});
</script>

<template>
  <div class="page">
    <div class="page-head">
      <h1>Störungen</h1>
      <div class="segmented">
        <RouterLink to="/stoerungen">Offen</RouterLink>
        <RouterLink to="/stoerungen/geloest">Gelöst</RouterLink>
      </div>
      <div class="spacer" />
      <MineToggle v-model="mine" />
      <button class="btn" type="button" @click="newOpen = true">+ Störung</button>
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
    <ItemTable v-else-if="!loading" v-model:sort="openSort" :items="items" show-status empty-text="Keine offenen Störungen" />
  </div>

  <NewItemDialog v-if="newOpen" fixed-type="incident" @close="newOpen = false" @created="onCreated" />
</template>
