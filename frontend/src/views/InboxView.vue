<script setup lang="ts">
import { defineAsyncComponent, ref, watch } from 'vue';
import { api } from '../api';
import ItemTable from '../components/ItemTable.vue';
import ListFilters from '../components/ListFilters.vue';
import MineToggle from '../components/MineToggle.vue';
import TypeChangeDialog from '../components/TypeChangeDialog.vue';
import { useListFilters, useListSort, useMineFilter, useReloadAfterItemModal } from '../composables';
import type { ItemKey } from '../item-ref';
import { listParams } from '../list-filters';
import { itemRef } from '../format';
import { itemHref, useOpenItem } from '../open-item';
import { useSession } from '../stores/session';
import { useToast } from '../stores/toast';
import type { ItemSummary, ItemType } from '../types';

// Erst beim Öffnen laden (enthält den Editor)
const NewItemDialog = defineAsyncComponent(() => import('../components/NewItemDialog.vue'));

const session = useSession();
const toast = useToast();
const openItem = useOpenItem();
const mine = useMineFilter('inbox');
const items = ref<ItemSummary[]>([]);
const loading = ref(true);
const busy = ref<string | null>(null);
const newOpen = ref(false);

// Neue Aufgaben öffnen nicht, die Meldung bietet «Öffnen»; Störungen öffnen wie bisher
function onCreated(created: ItemKey, type: ItemType) {
  newOpen.value = false;
  if (type === 'task') {
    toast.success(`${itemRef(created)} erstellt`, { text: 'Öffnen', to: itemHref(created), item: { ...created, type } });
    void session.refreshCounts();
    return;
  }
  toast.success('Vorgang erfasst');
  openItem(created, type);
}

// Filter (ohne Status, Vorgänge im Eingang haben keinen) und Sortierung, pro Ansicht gemerkt
const filters = useListFilters('inbox');
const sort = useListSort('inbox');

async function load() {
  try {
    const params = new URLSearchParams({ view: 'inbox', mine: mine.value ? '1' : '0', ...listParams(filters.value, sort.value) });
    items.value = (await api.get<{ items: ItemSummary[] }>(`/items?${params}`)).items;
  } catch (err) {
    toast.error(err);
  } finally {
    loading.value = false;
  }
}
watch([mine, () => JSON.stringify(filters.value), () => JSON.stringify(sort.value)], load, { immediate: true });
useReloadAfterItemModal(load);

// Zur Aufgabe fragt ein Dialog nach dem Status (ohne Vorauswahl); eine Störung erhält den Start-Status
const taskFor = ref<ItemSummary | null>(null);
async function onTaskAssigned() {
  const item = taskFor.value!;
  taskFor.value = null;
  toast.success(`${itemRef(item)} ist jetzt eine Aufgabe`);
  await Promise.all([load(), session.refreshCounts()]);
}

async function assign(item: ItemSummary, type: ItemType) {
  if (type === 'task') {
    taskFor.value = item;
    return;
  }
  busy.value = item.id;
  try {
    await api.post(`/items/${itemRef(item)}/type`, { type });
    toast.success(`${itemRef(item)} ist jetzt eine ${type === 'incident' ? 'Störung' : 'Aufgabe'}`);
    await Promise.all([load(), session.refreshCounts()]);
  } catch (err) {
    toast.error(err);
  } finally {
    busy.value = null;
  }
}

async function discard(item: ItemSummary) {
  busy.value = item.id;
  try {
    await api.post(`/items/${itemRef(item)}/discard`, { discarded: true });
    toast.success(`${itemRef(item)} verworfen`);
    await Promise.all([load(), session.refreshCounts()]);
  } catch (err) {
    toast.error(err);
  } finally {
    busy.value = null;
  }
}
</script>

<template>
  <div class="page">
    <div class="page-head">
      <h1>Eingang</h1>
      <span class="muted">Vorgänge aus E-Mail und Portal ohne Typ</span>
      <div class="spacer" />
      <MineToggle v-model="mine" />
      <button class="btn" type="button" @click="newOpen = true">+ Neu</button>
    </div>
    <ListFilters v-model="filters" :mine="mine" />
    <ItemTable v-if="!loading" v-model:sort="sort" :items="items" empty-text="Der Eingang ist leer.">
      <template #actions="{ item }">
        <div class="row">
          <!-- Der Vorschlag des Melders aus dem Portal ist hervorgehoben -->
          <!-- Nur Typen, deren Bereich man sieht (Bereiche je Rolle) -->
          <button
            v-if="session.canSee('incident')"
            class="btn btn-sm"
            :class="{ 'btn-primary': item.suggestedType === 'incident' }"
            type="button"
            :disabled="busy === item.id"
            @click="assign(item, 'incident')"
          >
            Störung
          </button>
          <button
            v-if="session.canSee('task')"
            class="btn btn-sm"
            :class="{ 'btn-primary': item.suggestedType === 'task' }"
            type="button"
            :disabled="busy === item.id"
            @click="assign(item, 'task')"
          >
            Aufgabe
          </button>
          <button
            class="btn btn-sm btn-ghost btn-danger"
            type="button"
            title="Spam oder Newsletter verwerfen"
            :disabled="busy === item.id"
            @click="discard(item)"
          >
            Verwerfen
          </button>
        </div>
      </template>
    </ItemTable>
  </div>

  <NewItemDialog v-if="newOpen" @close="newOpen = false" @created="onCreated" />
  <TypeChangeDialog
    v-if="taskFor"
    :item-key="taskFor"
    :type="null"
    :status="null"
    target-type="task"
    @close="taskFor = null"
    @done="onTaskAssigned"
  />
</template>
