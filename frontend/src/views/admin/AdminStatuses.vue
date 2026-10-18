<script setup lang="ts">
import { onMounted, ref } from 'vue';
import draggable from 'vuedraggable';
import { api, errorMessage } from '../../api';
import ModalDialog from '../../components/ModalDialog.vue';
import { CATEGORY_LABELS, CATEGORY_ORDER, TYPE_LABELS } from '../../format';
import { useSession } from '../../stores/session';
import { useToast } from '../../stores/toast';
import type { ItemType, Status, StatusCategory } from '../../types';

const session = useSession();
const toast = useToast();
const types: ItemType[] = ['incident', 'task'];

const CATEGORY_HINTS: Record<StatusCategory, string> = {
  new: 'Neue Vorgänge erhalten den ersten Status dieser Gruppe.',
  in_progress: 'In Bearbeitung. Antworten des Melders führen hierher zurück.',
  waiting: 'Wartet auf den Melder. Seine Antwort setzt den Vorgang auf «In Arbeit».',
  done: 'Abgeschlossen. Der Melder wird per Mail informiert, seine Antwort öffnet den Vorgang wieder.',
  rejected: 'Abgeschlossen über «Ablehnen». Erscheint nicht auf dem Board.',
};
const REQUIRED: StatusCategory[] = ['new', 'in_progress', 'done'];

type Groups = Record<StatusCategory, Status[]>;
const emptyGroups = (): Groups => ({ new: [], in_progress: [], waiting: [], done: [], rejected: [] });

const groups = ref<Record<ItemType, Groups>>({ incident: emptyGroups(), task: emptyGroups() });
const usage = ref<Record<string, number>>({});
const newLabel = ref<Record<string, string>>({});
const removing = ref<Status | null>(null);
const replacementId = ref('');
const removeError = ref('');

async function load() {
  try {
    await session.loadStatuses();
    usage.value = await api.get<Record<string, number>>('/statuses/usage');
    const next = { incident: emptyGroups(), task: emptyGroups() };
    for (const type of types) {
      for (const s of session.statusesOf(type)) next[type][s.category].push(s);
    }
    groups.value = next;
  } catch (err) {
    toast.error(err);
  }
}
onMounted(load);

const ofType = (type: ItemType) => CATEGORY_ORDER.flatMap((c) => groups.value[type][c]);

interface ChangeEvent {
  added?: { element: Status };
  moved?: { element: Status };
}

/** Sortieren innerhalb einer Gruppe oder Verschieben in eine andere Kategorie. */
async function onChange(type: ItemType, category: StatusCategory, event: ChangeEvent) {
  const change = event.added ?? event.moved;
  if (!change) return; // «removed» wird in der Zielgruppe behandelt
  try {
    if (event.added && change.element.category !== category) {
      await api.patch(`/statuses/${change.element.id}`, { category });
    }
    await api.put('/statuses/order', { type, ids: ofType(type).map((s) => s.id) });
  } catch (err) {
    toast.error(err);
  }
  await load();
}

async function rename(status: Status, e: Event) {
  const label = (e.target as HTMLInputElement).value.trim();
  if (!label || label === status.label) return;
  try {
    await api.patch(`/statuses/${status.id}`, { label });
    await load();
  } catch (err) {
    toast.error(err);
    await load();
  }
}

async function add(type: ItemType, category: StatusCategory) {
  const key = `${type}:${category}`;
  const label = newLabel.value[key]?.trim();
  if (!label) return;
  try {
    await api.post('/statuses', { type, label, category });
    newLabel.value[key] = '';
    await load();
  } catch (err) {
    toast.error(err);
  }
}

function askRemove(status: Status) {
  removing.value = status;
  replacementId.value = '';
  removeError.value = '';
}

async function confirmRemove() {
  const status = removing.value;
  if (!status) return;
  try {
    const query = replacementId.value ? `?replacementId=${replacementId.value}` : '';
    await api.delete(`/statuses/${status.id}${query}`);
    removing.value = null;
    toast.success('Status gelöscht');
    await load();
  } catch (err) {
    removeError.value = errorMessage(err);
  }
}
</script>

<template>
  <div class="stack">
    <h1>Status</h1>
    <p class="muted" style="margin: 0">
      Die Status sind nach Kategorie gruppiert. Die Kategorie steuert das Verhalten, beim Typwechsel wird nach Kategorie zugeordnet.
      Reihenfolge und Kategorie lassen sich per Ziehen ändern; die Reihenfolge gilt auch für die Spalten des Boards.
    </p>
    <div class="types">
      <div v-for="type in types" :key="type" class="card card-body stack">
        <h2>{{ TYPE_LABELS[type] }}</h2>
        <section v-for="category in CATEGORY_ORDER" :key="category" class="group">
          <header class="group-head">
            <span class="badge" :class="`cat-${category}`">{{ CATEGORY_LABELS[category] }}</span>
            <span v-if="REQUIRED.includes(category)" class="faint required">Pflicht</span>
          </header>
          <p class="faint hint">{{ CATEGORY_HINTS[category] }}</p>
          <draggable
            v-model="groups[type][category]"
            item-key="id"
            handle=".handle"
            :group="`statuses-${type}`"
            class="list"
            :animation="120"
            @change="onChange(type, category, $event)"
          >
            <template #item="{ element }">
              <div class="status-row">
                <span class="handle" title="Ziehen zum Sortieren oder in eine andere Kategorie">⋮⋮</span>
                <input class="input label-input" :value="element.label" maxlength="60" @change="rename(element, $event)" />
                <span class="faint usage" title="Vorgänge mit diesem Status">{{ usage[element.id] ?? 0 }}</span>
                <button class="btn btn-sm btn-ghost btn-danger" type="button" :aria-label="`${element.label} löschen`" @click="askRemove(element)">
                  ✕
                </button>
              </div>
            </template>
            <template #footer>
              <div v-if="groups[type][category].length === 0" class="empty-group faint">Kein Status – hierher ziehen oder hinzufügen</div>
            </template>
          </draggable>
          <form class="status-row add-row" @submit.prevent="add(type, category)">
            <span class="handle" />
            <input v-model="newLabel[`${type}:${category}`]" class="input label-input" placeholder="Status hinzufügen" maxlength="60" />
            <button class="btn btn-sm" type="submit" :disabled="!newLabel[`${type}:${category}`]?.trim()">+</button>
          </form>
        </section>
      </div>
    </div>

    <ModalDialog v-if="removing" :title="`Status «${removing.label}» löschen`" @close="removing = null">
      <p v-if="(usage[removing.id] ?? 0) > 0" style="margin: 0">
        {{ usage[removing.id] }} Vorgänge haben diesen Status. Welchen Status sollen sie stattdessen erhalten?
      </p>
      <p v-else style="margin: 0">Der Status wird von keinem Vorgang verwendet.</p>
      <select v-if="(usage[removing.id] ?? 0) > 0" v-model="replacementId" class="select">
        <option value="" disabled>Ersatzstatus wählen</option>
        <option v-for="s in ofType(removing.type).filter((x) => x.id !== removing!.id)" :key="s.id" :value="s.id">
          {{ s.label }} ({{ CATEGORY_LABELS[s.category] }})
        </option>
      </select>
      <div v-if="removeError" class="error-box">{{ removeError }}</div>
      <template #footer>
        <button class="btn" type="button" @click="removing = null">Abbrechen</button>
        <button class="btn btn-danger" type="button" :disabled="(usage[removing.id] ?? 0) > 0 && !replacementId" @click="confirmRemove">
          Löschen
        </button>
      </template>
    </ModalDialog>
  </div>
</template>

<style scoped>
.types {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(340px, 1fr));
  gap: 16px;
  align-items: start;
}
.group {
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding-top: 12px;
  border-top: 1px solid var(--border);
}
.group-head {
  display: flex;
  align-items: center;
  gap: 8px;
}
.required {
  font-size: 12px;
}
.hint {
  margin: 0;
  font-size: 12px;
}
.list {
  display: flex;
  flex-direction: column;
  gap: 6px;
  min-height: 8px;
}
.status-row {
  display: flex;
  align-items: center;
  gap: 8px;
}
.handle {
  width: 16px;
  flex-shrink: 0;
  cursor: grab;
  color: var(--text-faint);
  user-select: none;
}
.add-row .handle {
  cursor: default;
}
.label-input {
  flex: 1;
  min-width: 0;
}
.usage {
  width: 28px;
  text-align: right;
  font-size: 12px;
}
.empty-group {
  padding: 8px 10px;
  border: 1px dashed var(--border-strong);
  border-radius: var(--radius-sm);
  font-size: 12px;
}
</style>
