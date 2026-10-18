<script setup lang="ts">
import { computed, ref } from 'vue';
import draggable from 'vuedraggable';
import { api } from '../api';
import { formatDateTime } from '../format';
import { useConfirm } from '../stores/confirm';
import { useToast } from '../stores/toast';
import type { Checklist, ChecklistEntry, ChecklistTemplate } from '../types';

/** Checklisten einer Aufgabe: abhaken, ergänzen, sortieren, Vorlagen einfügen. */
const props = defineProps<{ number: number; checklists: Checklist[] }>();
const emit = defineEmits<{ changed: [] }>();
const toast = useToast();
const confirm = useConfirm();

const newTitle = ref('');
const adding = ref(false);
const newItemText = ref<Record<string, string>>({});
const editingTitle = ref<string | null>(null);
const titleDraft = ref('');
const editingEntry = ref<string | null>(null);
const entryDraft = ref('');
const templates = ref<ChecklistTemplate[] | null>(null);
const templatesOpen = ref(false);
const busy = ref(false);

const totals = computed(() => {
  const all = props.checklists.flatMap((c) => c.items);
  return { done: all.filter((i) => i.done).length, total: all.length };
});

/** Lokale Kopie für Drag & Drop der Punkte */
const lists = computed(() => props.checklists.map((c) => ({ ...c, items: [...c.items] })));

async function run(action: () => Promise<unknown>) {
  busy.value = true;
  try {
    await action();
    emit('changed');
  } catch (err) {
    toast.error(err);
    emit('changed');
  } finally {
    busy.value = false;
  }
}

function createChecklist() {
  const title = newTitle.value.trim();
  if (!title) return;
  void run(async () => {
    await api.post(`/items/${props.number}/checklists`, { title });
    newTitle.value = '';
    adding.value = false;
  });
}

async function openTemplates() {
  templatesOpen.value = !templatesOpen.value;
  if (templatesOpen.value && !templates.value) {
    try {
      templates.value = await api.get<ChecklistTemplate[]>('/checklist-templates');
    } catch (err) {
      toast.error(err);
    }
  }
}

function insertTemplate(t: ChecklistTemplate) {
  templatesOpen.value = false;
  void run(() => api.post(`/items/${props.number}/checklists/from-template`, { templateId: t.id }));
}

function startTitle(c: Checklist) {
  editingTitle.value = c.id;
  titleDraft.value = c.title;
}
function saveTitle(c: Checklist) {
  const title = titleDraft.value.trim();
  editingTitle.value = null;
  if (title && title !== c.title) void run(() => api.patch(`/checklists/${c.id}`, { title }));
}

async function removeChecklist(c: Checklist) {
  const ok = await confirm.ask({
    title: 'Checkliste löschen',
    message: `«${c.title}» mit ${c.items.length} Punkten löschen?`,
    confirmLabel: 'Löschen',
    danger: true,
  });
  if (ok) void run(() => api.delete(`/checklists/${c.id}`));
}

function addItem(c: Checklist) {
  const text = newItemText.value[c.id]?.trim();
  if (!text) return;
  newItemText.value[c.id] = '';
  void run(() => api.post(`/checklists/${c.id}/items`, { text }));
}

function toggle(entry: ChecklistEntry) {
  void run(() => api.patch(`/checklist-items/${entry.id}`, { done: !entry.done }));
}

function startEntry(entry: ChecklistEntry) {
  editingEntry.value = entry.id;
  entryDraft.value = entry.text;
}
function saveEntry(entry: ChecklistEntry) {
  const text = entryDraft.value.trim();
  editingEntry.value = null;
  if (text && text !== entry.text) void run(() => api.patch(`/checklist-items/${entry.id}`, { text }));
}

function removeEntry(entry: ChecklistEntry) {
  void run(() => api.delete(`/checklist-items/${entry.id}`));
}

function reorder(c: { id: string; items: ChecklistEntry[] }) {
  void run(() => api.put(`/checklists/${c.id}/items/order`, { ids: c.items.map((i) => i.id) }));
}

const doneTitle = (e: ChecklistEntry) => (e.done && e.doneBy ? `Erledigt von ${e.doneBy} am ${formatDateTime(e.doneAt)}` : '');
</script>

<template>
  <section class="card checklists">
    <div class="row head">
      <h3>Checklisten</h3>
      <span v-if="totals.total" class="faint small">{{ totals.done }}/{{ totals.total }} erledigt</span>
      <span class="spacer" />
      <div class="templates">
        <button class="btn btn-sm" type="button" :disabled="busy" @click="openTemplates">Vorlage einfügen</button>
        <div v-if="templatesOpen" class="template-menu card">
          <div v-if="templates && !templates.length" class="faint small pad">Keine Vorlagen vorhanden (Verwaltung → Checklisten-Vorlagen).</div>
          <button v-for="t in templates ?? []" :key="t.id" type="button" class="template-option" @click="insertTemplate(t)">
            {{ t.name }} <span class="faint small">· {{ t.items.length }} Punkte</span>
          </button>
        </div>
      </div>
      <button class="btn btn-sm" type="button" :disabled="busy" @click="adding = !adding">+ Checkliste</button>
    </div>

    <form v-if="adding" class="row" @submit.prevent="createChecklist">
      <input v-model="newTitle" class="input" placeholder="Titel der Checkliste" maxlength="200" autofocus />
      <button class="btn btn-primary" type="submit" :disabled="!newTitle.trim()">Anlegen</button>
    </form>

    <div v-for="c in lists" :key="c.id" class="checklist">
      <div class="row list-head">
        <input
          v-if="editingTitle === c.id"
          v-model="titleDraft"
          class="input title-input"
          maxlength="200"
          @keydown.enter.prevent="saveTitle(c)"
          @keydown.esc="editingTitle = null"
          @blur="saveTitle(c)"
        />
        <strong v-else class="list-title" title="Klicken zum Umbenennen" @click="startTitle(c)">{{ c.title }}</strong>
        <span class="faint small">{{ c.items.filter((i) => i.done).length }}/{{ c.items.length }}</span>
        <span class="spacer" />
        <button class="icon-btn" type="button" :aria-label="`${c.title} löschen`" @click="removeChecklist(c)">✕</button>
      </div>
      <div class="progress" :aria-label="`${c.items.filter((i) => i.done).length} von ${c.items.length} erledigt`">
        <div
          class="bar"
          :style="{ width: c.items.length ? `${(c.items.filter((i) => i.done).length / c.items.length) * 100}%` : '0%' }"
        />
      </div>
      <draggable v-model="c.items" item-key="id" handle=".handle" :animation="120" class="entries" @end="reorder(c)">
        <template #item="{ element }">
          <div class="entry" :class="{ done: element.done }" :title="doneTitle(element)">
            <span class="handle" aria-hidden="true">⋮⋮</span>
            <input type="checkbox" :checked="element.done" :disabled="busy" @change="toggle(element)" />
            <input
              v-if="editingEntry === element.id"
              v-model="entryDraft"
              class="input entry-input"
              maxlength="1000"
              @keydown.enter.prevent="saveEntry(element)"
              @keydown.esc="editingEntry = null"
              @blur="saveEntry(element)"
            />
            <span v-else class="entry-text" @dblclick="startEntry(element)">{{ element.text }}</span>
            <button class="icon-btn" type="button" aria-label="Punkt löschen" @click="removeEntry(element)">✕</button>
          </div>
        </template>
      </draggable>
      <form class="row add-entry" @submit.prevent="addItem(c)">
        <input v-model="newItemText[c.id]" class="input" placeholder="Punkt hinzufügen" maxlength="1000" />
        <button class="btn btn-sm" type="submit" :disabled="!newItemText[c.id]?.trim()">+</button>
      </form>
    </div>
    <div v-if="!lists.length && !adding" class="faint small">Noch keine Checkliste. Doppelklick auf einen Punkt bearbeitet ihn.</div>
  </section>
</template>

<style scoped>
.checklists {
  padding: 12px 14px;
  display: flex;
  flex-direction: column;
  gap: 12px;
}
.head {
  flex-wrap: wrap;
}
.small {
  font-size: 12px;
}
.templates {
  position: relative;
}
.template-menu {
  position: absolute;
  right: 0;
  top: 32px;
  z-index: 20;
  min-width: 240px;
  padding: 6px;
  display: flex;
  flex-direction: column;
  box-shadow: var(--shadow-lg);
}
.template-option {
  text-align: left;
  padding: 6px 8px;
  border: none;
  background: none;
  border-radius: var(--radius-sm);
  font: inherit;
  color: var(--text);
  cursor: pointer;
}
.template-option:hover {
  background: var(--surface-hover);
}
.pad {
  padding: 6px 8px;
}
.checklist {
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding-top: 10px;
  border-top: 1px solid var(--border);
}
.list-title {
  cursor: text;
}
.title-input {
  max-width: 320px;
}
.progress {
  height: 6px;
  border-radius: 3px;
  background: var(--surface-2);
  overflow: hidden;
}
.bar {
  height: 100%;
  background: var(--success);
  transition: width 0.2s;
}
.entries {
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.entry {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 3px 4px;
  border-radius: var(--radius-sm);
}
.entry:hover {
  background: var(--surface-hover);
}
.entry input[type='checkbox'] {
  width: 16px;
  height: 16px;
  accent-color: var(--success);
  flex-shrink: 0;
}
.entry-text {
  flex: 1;
  overflow-wrap: anywhere;
}
.entry.done .entry-text {
  color: var(--text-faint);
  text-decoration: line-through;
}
.entry-input {
  flex: 1;
  height: 28px;
}
.handle {
  cursor: grab;
  color: var(--text-faint);
  user-select: none;
  width: 12px;
}
.icon-btn {
  border: none;
  background: none;
  color: var(--text-faint);
  cursor: pointer;
  padding: 0 4px;
  font-size: 12px;
  visibility: hidden;
}
.entry:hover .icon-btn,
.list-head:hover .icon-btn,
.icon-btn:focus-visible {
  visibility: visible;
}
.icon-btn:hover {
  color: var(--danger);
}
.add-entry .input {
  height: 30px;
}
</style>
