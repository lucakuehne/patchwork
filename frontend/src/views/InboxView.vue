<script setup lang="ts">
import { defineAsyncComponent, ref, watch } from 'vue';
import { useRouter } from 'vue-router';
import { api } from '../api';
import ItemTable from '../components/ItemTable.vue';
import MineToggle from '../components/MineToggle.vue';
import TypeChangeDialog from '../components/TypeChangeDialog.vue';
import { useMineFilter } from '../composables';
import { itemRef } from '../format';
import { useSession } from '../stores/session';
import { useToast } from '../stores/toast';
import type { ItemSummary, ItemType } from '../types';

// Erst beim Öffnen laden (enthält den Editor)
const NewItemDialog = defineAsyncComponent(() => import('../components/NewItemDialog.vue'));

const session = useSession();
const toast = useToast();
const router = useRouter();
const mine = useMineFilter('inbox');
const items = ref<ItemSummary[]>([]);
const loading = ref(true);
const busy = ref<number | null>(null);
const newOpen = ref(false);

// Neue Aufgaben öffnen nicht, die Meldung bietet «Öffnen»; Störungen öffnen wie bisher
function onCreated(number: number, type: ItemType) {
  newOpen.value = false;
  if (type === 'task') {
    toast.success(`${itemRef(number)} erstellt`, { text: 'Öffnen', to: `/v/${number}` });
    void session.refreshCounts();
    return;
  }
  toast.success('Vorgang erfasst');
  void router.push({ name: 'item', params: { number } });
}

async function load() {
  try {
    items.value = (await api.get<{ items: ItemSummary[] }>(`/items?view=inbox&mine=${mine.value ? 1 : 0}`)).items;
  } catch (err) {
    toast.error(err);
  } finally {
    loading.value = false;
  }
}
watch(mine, load, { immediate: true });

// Zur Aufgabe fragt ein Dialog nach dem Status (ohne Vorauswahl); eine Störung erhält den Start-Status
const taskFor = ref<ItemSummary | null>(null);
async function onTaskAssigned() {
  const item = taskFor.value!;
  taskFor.value = null;
  toast.success(`${itemRef(item.number)} ist jetzt eine Aufgabe`);
  await Promise.all([load(), session.refreshCounts()]);
}

async function assign(item: ItemSummary, type: ItemType) {
  if (type === 'task') {
    taskFor.value = item;
    return;
  }
  busy.value = item.number;
  try {
    await api.post(`/items/${item.number}/type`, { type });
    toast.success(`${itemRef(item.number)} ist jetzt eine ${type === 'incident' ? 'Störung' : 'Aufgabe'}`);
    await Promise.all([load(), session.refreshCounts()]);
  } catch (err) {
    toast.error(err);
  } finally {
    busy.value = null;
  }
}

async function discard(item: ItemSummary) {
  busy.value = item.number;
  try {
    await api.post(`/items/${item.number}/discard`, { discarded: true });
    toast.success(`${itemRef(item.number)} verworfen`);
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
    <ItemTable v-if="!loading" :items="items" empty-text="Der Eingang ist leer.">
      <template #actions="{ item }">
        <div class="row">
          <!-- Der Vorschlag des Melders aus dem Portal ist hervorgehoben -->
          <!-- Nur Typen, deren Bereich man sieht (Bereiche je Rolle) -->
          <button
            v-if="session.canSee('incident')"
            class="btn btn-sm"
            :class="{ 'btn-primary': item.suggestedType === 'incident' }"
            type="button"
            :disabled="busy === item.number"
            @click="assign(item, 'incident')"
          >
            Störung
          </button>
          <button
            v-if="session.canSee('task')"
            class="btn btn-sm"
            :class="{ 'btn-primary': item.suggestedType === 'task' }"
            type="button"
            :disabled="busy === item.number"
            @click="assign(item, 'task')"
          >
            Aufgabe
          </button>
          <button
            class="btn btn-sm btn-ghost btn-danger"
            type="button"
            title="Spam oder Newsletter verwerfen"
            :disabled="busy === item.number"
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
    :number="taskFor.number"
    :type="null"
    :status="null"
    target-type="task"
    @close="taskFor = null"
    @done="onTaskAssigned"
  />
</template>
