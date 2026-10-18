<script setup lang="ts">
import { defineAsyncComponent, ref, watch } from 'vue';
import { useRouter } from 'vue-router';
import { api } from '../api';
import ItemTable from '../components/ItemTable.vue';
import MineToggle from '../components/MineToggle.vue';
import PagedList from '../components/PagedList.vue';
import { useMineFilter } from '../composables';
import { useToast } from '../stores/toast';
import type { ItemSummary } from '../types';

const NewItemDialog = defineAsyncComponent(() => import('../components/NewItemDialog.vue'));

const props = defineProps<{ closed: boolean }>();
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

async function load() {
  if (props.closed) return;
  try {
    items.value = (await api.get<{ items: ItemSummary[] }>(`/items?view=incidents&mine=${mine.value ? 1 : 0}`)).items;
  } catch (err) {
    toast.error(err);
  } finally {
    loading.value = false;
  }
}
watch([mine, () => props.closed], load, { immediate: true });
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
    <PagedList v-if="closed" view="incidents-closed" :mine="mine" show-status show-closed empty-text="Keine gelösten Störungen" />
    <ItemTable v-else-if="!loading" :items="items" show-status empty-text="Keine offenen Störungen" />
  </div>

  <NewItemDialog v-if="newOpen" fixed-type="incident" @close="newOpen = false" @created="onCreated" />
</template>
