<script setup lang="ts">
import { defineAsyncComponent, ref, watch } from 'vue';
import { api } from '../api';
import ItemTable from '../components/ItemTable.vue';
import ListFilters from '../components/ListFilters.vue';
import TypeChangeDialog from '../components/TypeChangeDialog.vue';
import { useListFilters, useListSort, useReloadAfterItemModal } from '../composables';
import type { ItemKey } from '../item-ref';
import { listParams } from '../list-filters';
import { itemRef } from '../format';
import { itemHref, useOpenItem } from '../open-item';
import { sendStatusChange } from '../status-move';
import { useSession } from '../stores/session';
import { useToast } from '../stores/toast';
import type { ItemSummary, ItemType } from '../types';

// Erst beim Öffnen laden (enthält den Editor)
const NewItemDialog = defineAsyncComponent(() => import('../components/NewItemDialog.vue'));
const ImportMailDialog = defineAsyncComponent(() => import('../components/ImportMailDialog.vue'));

const session = useSession();
const toast = useToast();
const openItem = useOpenItem();
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

// Filter (ohne Status, Vorgänge im Eingang haben keinen) und Sortierung, pro Ansicht gemerkt; kein «Nur meine»
// (seit 03.11.2026), im Eingang ist kaum etwas zugewiesen
const filters = useListFilters('inbox');
const sort = useListSort('inbox');
// Ohne Spalten Priorität und Zuständig: eine früher gewählte Sortierung danach fällt weg
if (sort.value && ['priority', 'assignee'].includes(sort.value.field)) sort.value = null;

async function load() {
  try {
    const params = new URLSearchParams({ view: 'inbox', ...listParams(filters.value, sort.value) });
    items.value = (await api.get<{ items: ItemSummary[] }>(`/items?${params}`)).items;
  } catch (err) {
    toast.error(err);
  } finally {
    loading.value = false;
  }
}
watch([() => JSON.stringify(filters.value), () => JSON.stringify(sort.value)], load, { immediate: true });
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
    const sent = await sendStatusChange(({ assigneeId }) =>
      api.post(`/items/${itemRef(item)}/type`, { type, ...(assigneeId ? { assigneeId } : {}) }),
    );
    if (!sent) return;
    toast.success(`${itemRef(item)} ist jetzt eine ${type === 'incident' ? 'Störung' : 'Aufgabe'}`);
    await Promise.all([load(), session.refreshCounts()]);
  } catch (err) {
    toast.error(err);
  } finally {
    busy.value = null;
  }
}

/*
 * Mails importieren (Entscheid vom 10.11.2026): über den Knopf (Dateiauswahl) oder per Ziehen auf die Seite, direkt aus
 * Outlook (.msg) oder als Datei (.eml, .msg). Die Prüfung, ob es Mails sind, macht die Vorschau.
 */
const importFiles = ref<File[] | null>(null);
const fileInput = ref<HTMLInputElement | null>(null);
const dragging = ref(false);
let dragDepth = 0;
const hasFiles = (e: DragEvent) => !!e.dataTransfer?.types.includes('Files');

function chooseFiles(e: Event) {
  const input = e.target as HTMLInputElement;
  if (input.files?.length) importFiles.value = [...input.files];
  input.value = '';
}
function onDragEnter(e: DragEvent) {
  if (!hasFiles(e)) return;
  dragDepth++;
  dragging.value = true;
}
function onDragLeave(e: DragEvent) {
  if (!hasFiles(e)) return;
  dragDepth = Math.max(0, dragDepth - 1);
  if (!dragDepth) dragging.value = false;
}
function onDragOver(e: DragEvent) {
  if (!hasFiles(e)) return;
  e.preventDefault();
  if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy';
}
function onDrop(e: DragEvent) {
  if (!hasFiles(e)) return;
  e.preventDefault();
  dragDepth = 0;
  dragging.value = false;
  const files = [...(e.dataTransfer?.files ?? [])];
  if (files.length) importFiles.value = files;
}
async function onImported() {
  await Promise.all([load(), session.refreshCounts()]);
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
  <div
    class="page inbox-page"
    :class="{ dragging }"
    @dragenter="onDragEnter"
    @dragleave="onDragLeave"
    @dragover="onDragOver"
    @drop="onDrop"
  >
    <div class="page-head">
      <h1>Eingang</h1>
      <span class="muted">Vorgänge aus E-Mail und Portal ohne Typ</span>
      <div class="spacer" />
      <button
        class="btn"
        type="button"
        title="Mails, die an eine andere Adresse gingen, als .eml oder .msg übernehmen; Mails lassen sich auch direkt aus Outlook hierher ziehen"
        @click="fileInput?.click()"
      >
        Mail importieren
      </button>
      <input ref="fileInput" class="file-input" type="file" accept=".eml,.msg,message/rfc822" multiple @change="chooseFiles" />
      <button class="btn" type="button" @click="newOpen = true">+ Neu</button>
    </div>
    <div v-if="dragging" class="drop-hint" aria-hidden="true">Mails hier ablegen, um sie zu importieren (.eml oder .msg)</div>
    <ListFilters v-model="filters" inbox />
    <ItemTable v-if="!loading" v-model:sort="sort" :items="items" inbox empty-text="Der Eingang ist leer.">
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
  <ImportMailDialog v-if="importFiles" :files="importFiles" @close="importFiles = null" @done="onImported" />
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

<style scoped>
.inbox-page {
  position: relative;
  min-height: calc(100vh - 140px);
}
/* Beim Ziehen von Dateien: ganze Seite als Ablagefläche */
.inbox-page.dragging {
  outline: 2px dashed var(--accent);
  outline-offset: -6px;
  border-radius: var(--radius);
}
.drop-hint {
  position: absolute;
  inset: 6px;
  display: flex;
  align-items: center;
  justify-content: center;
  background: color-mix(in srgb, var(--accent-soft) 85%, transparent);
  color: var(--accent);
  font-weight: 600;
  border-radius: var(--radius);
  pointer-events: none;
  z-index: 5;
}
.file-input {
  display: none;
}
</style>
