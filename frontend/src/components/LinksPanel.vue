<script setup lang="ts">
import { ref, watch } from 'vue';
import { api, errorMessage } from '../api';
import { useDebounced } from '../composables';
import { itemRef, TYPE_LABELS } from '../format';
import { useToast } from '../stores/toast';
import type { ItemLink, ItemSummary, LinkRole } from '../types';
import ModalDialog from './ModalDialog.vue';
import StatusBadge from './StatusBadge.vue';

/** Verknüpfungen eines Vorgangs (Seitenleiste). */
const props = defineProps<{ number: number; links: ItemLink[] }>();
const emit = defineEmits<{ changed: [] }>();
const toast = useToast();

const ROLE_LABELS: Record<LinkRole, string> = {
  relates: 'Bezieht sich auf',
  fixes: 'Behebt',
  fixedBy: 'Wird behoben durch',
  duplicateOf: 'Duplikat von',
  hasDuplicate: 'Hat Duplikat',
};

const ROLE_SENTENCES: Record<LinkRole, string> = {
  relates: 'bezieht sich auf',
  fixes: 'behebt',
  fixedBy: 'wird behoben durch',
  duplicateOf: 'ist ein Duplikat von',
  hasDuplicate: 'hat als Duplikat',
};

const open = ref(false);
const role = ref<LinkRole>('relates');
const query = ref('');
const debounced = useDebounced(query, 250);
const results = ref<ItemSummary[]>([]);
const error = ref('');
const busy = ref(false);

watch(debounced, async (q) => {
  if (!q.trim()) {
    results.value = [];
    return;
  }
  try {
    const data = await api.get<{ items: ItemSummary[] }>(`/items?view=search&q=${encodeURIComponent(q.trim())}&limit=10`);
    results.value = data.items.filter((i) => i.number !== props.number);
  } catch (err) {
    toast.error(err);
  }
});

function openDialog() {
  open.value = true;
  role.value = 'relates';
  query.value = '';
  results.value = [];
  error.value = '';
}

async function link(other: ItemSummary) {
  busy.value = true;
  error.value = '';
  try {
    await api.post(`/items/${props.number}/links`, { role: role.value, otherNumber: other.number });
    open.value = false;
    emit('changed');
  } catch (err) {
    error.value = errorMessage(err);
  } finally {
    busy.value = false;
  }
}

async function unlink(l: ItemLink) {
  try {
    await api.delete(`/items/${props.number}/links/${l.id}`);
    emit('changed');
  } catch (err) {
    toast.error(err);
  }
}
</script>

<template>
  <div class="field">
    <div class="row">
      <span class="label">Verknüpfungen</span>
      <span class="spacer" />
      <button class="link-btn" type="button" @click="openDialog">+ Verknüpfen</button>
    </div>
    <div v-for="l in links" :key="l.id" class="link-row">
      <span class="role faint">{{ ROLE_LABELS[l.role] }}</span>
      <div class="other">
        <RouterLink :to="`/v/${l.other.number}`" class="other-title" :title="l.other.title">
          <span class="mono">{{ itemRef(l.other.number) }}</span> {{ l.other.title }}
        </RouterLink>
        <StatusBadge v-if="l.other.status" :status="{ id: '', ...l.other.status }" />
      </div>
      <button class="icon-btn" type="button" aria-label="Verknüpfung entfernen" @click="unlink(l)">✕</button>
    </div>
    <span v-if="!links.length" class="faint small">Keine</span>
  </div>

  <ModalDialog v-if="open" :title="`${itemRef(number)} verknüpfen`" @close="open = false">
    <div class="field">
      <label for="link-role">Art</label>
      <select id="link-role" v-model="role" class="select">
        <option v-for="(sentence, key) in ROLE_SENTENCES" :key="key" :value="key">{{ itemRef(number) }} {{ sentence }} …</option>
      </select>
      <p v-if="role === 'duplicateOf' || role === 'hasDuplicate'" class="faint small hint">
        Das Duplikat wird geschlossen und zum Original umgeleitet: Sein Melder und seine Beteiligten erhalten einen Hinweis
        per Mail und künftig die Updates des Originals. Bei gleichem Melder wird die Meldung ins Original übernommen.
      </p>
    </div>
    <div class="field">
      <label for="link-search">Vorgang suchen</label>
      <input id="link-search" v-model="query" class="input" placeholder="Nummer oder Text" autofocus />
    </div>
    <div class="results">
      <button v-for="r in results" :key="r.id" type="button" class="result" :disabled="busy" @click="link(r)">
        <span class="mono muted">{{ itemRef(r.number) }}</span>
        <span class="result-title">{{ r.title }}</span>
        <span class="faint small">{{ r.type ? TYPE_LABELS[r.type] : 'Eingang' }}</span>
      </button>
      <span v-if="query.trim() && !results.length" class="faint small">Keine Treffer</span>
    </div>
    <div v-if="error" class="error-box">{{ error }}</div>
  </ModalDialog>
</template>

<style scoped>
.small {
  font-size: 12px;
}
.hint {
  margin: 4px 0 0;
}
.link-row {
  display: flex;
  align-items: flex-start;
  gap: 6px;
}
.role {
  font-size: 12px;
  width: 108px;
  flex-shrink: 0;
  padding-top: 2px;
}
.other {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 2px;
  align-items: flex-start;
}
.other-title {
  display: block;
  max-width: 100%;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 13px;
}
.icon-btn {
  border: none;
  background: none;
  color: var(--text-faint);
  cursor: pointer;
  font-size: 12px;
}
.icon-btn:hover {
  color: var(--danger);
}
.results {
  display: flex;
  flex-direction: column;
  gap: 2px;
  max-height: 280px;
  overflow-y: auto;
}
.result {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 8px;
  border: none;
  background: none;
  border-radius: var(--radius-sm);
  font: inherit;
  color: var(--text);
  text-align: left;
  cursor: pointer;
}
.result:hover {
  background: var(--surface-hover);
}
.result-title {
  flex: 1;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
</style>
