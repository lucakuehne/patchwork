<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue';
import { api, errorMessage } from '../api';
import { useDebounced } from '../composables';
import { formatDate, itemRef, TYPE_LABELS } from '../format';
import { sameItem, type ItemKey } from '../item-ref';
import { useToast } from '../stores/toast';
import type { ItemSummary, ItemType, MergeCandidate } from '../types';
import ModalDialog from './ModalDialog.vue';
import StatusBadge from './StatusBadge.vue';

/**
 * Zwei Vorgänge desselben Melders zusammenführen (Entscheid vom 02.11.2026). Dahinter steht «Duplikat von»: Der
 * bleibende Vorgang übernimmt alles, der andere wird geschlossen. Vorgeschlagen werden die offenen Vorgänge desselben
 * Melders, weitere lassen sich suchen; Treffer anderer Melder sind nicht wählbar (seit 02.11.2026).
 */
const props = defineProps<{ itemKey: ItemKey; reporter: { id: string; name: string } }>();
const emit = defineEmits<{ close: []; merged: [] }>();
const toast = useToast();

interface Choice {
  id: string;
  prefix: string;
  number: number;
  title: string;
  type: ItemType | null;
  /** Melder, falls bekannt (Suche); die Vorschläge haben denselben Melder */
  reporter?: { id: string; name: string };
}

const self = computed(() => itemRef(props.itemKey));
const direction = ref<'duplicateOf' | 'hasDuplicate'>('duplicateOf');
const candidates = ref<MergeCandidate[] | null>(null);
const query = ref('');
const debounced = useDebounced(query, 250);
const results = ref<ItemSummary[]>([]);
const chosen = ref<Choice | null>(null);
const error = ref('');
const busy = ref(false);

onMounted(async () => {
  try {
    candidates.value = (await api.get<{ items: MergeCandidate[] }>(`/items/${self.value}/merge-candidates`)).items;
  } catch (err) {
    candidates.value = [];
    toast.error(err);
  }
});

watch(debounced, async (q) => {
  if (!q.trim()) {
    results.value = [];
    return;
  }
  try {
    const data = await api.get<{ items: ItemSummary[] }>(`/items?view=search&q=${encodeURIComponent(q.trim())}&limit=10`);
    results.value = data.items.filter((i) => !sameItem(i, props.itemKey));
  } catch (err) {
    toast.error(err);
  }
});

// Was geschieht: welcher Vorgang bleibt, welcher wird übernommen und geschlossen
const outcome = computed(() => {
  if (!chosen.value) return '';
  const other = itemRef(chosen.value);
  return direction.value === 'duplicateOf'
    ? `${self.value} wird in ${other} übernommen und geschlossen. ${other} bleibt.`
    : `${other} wird in ${self.value} übernommen und geschlossen. ${self.value} bleibt.`;
});
/** Treffer eines anderen Melders: nicht wählbar, dafür gibt es «Bezieht sich auf» */
const otherReporter = (r: ItemSummary) => r.reporter.id !== props.reporter.id;

async function merge() {
  const other = chosen.value;
  if (!other) return;
  busy.value = true;
  error.value = '';
  try {
    await api.post(`/items/${self.value}/links`, { role: direction.value, other: itemRef(other) });
    const [from, into] = direction.value === 'duplicateOf' ? [self.value, itemRef(other)] : [itemRef(other), self.value];
    toast.success(`${from} in ${into} zusammengeführt`);
    emit('merged');
  } catch (err) {
    error.value = errorMessage(err);
  } finally {
    busy.value = false;
  }
}
</script>

<template>
  <ModalDialog :title="`${self} zusammenführen`" @close="emit('close')">
    <div class="field">
      <label for="merge-direction">Richtung</label>
      <select id="merge-direction" v-model="direction" class="select">
        <option value="duplicateOf">{{ self }} in einen anderen Vorgang übernehmen</option>
        <option value="hasDuplicate">Einen anderen Vorgang in {{ self }} übernehmen</option>
      </select>
    </div>

    <div class="field">
      <span class="label">Offene Vorgänge von {{ reporter.name }}</span>
      <div class="results">
        <button
          v-for="c in candidates ?? []"
          :key="c.id"
          type="button"
          class="result"
          :class="{ chosen: chosen?.id === c.id }"
          :aria-pressed="chosen?.id === c.id"
          @click="chosen = c"
        >
          <span class="mono muted">{{ itemRef(c) }}</span>
          <span class="result-title">{{ c.title }}</span>
          <StatusBadge :status="c.status && { id: '', ...c.status }" />
          <span class="faint small">{{ formatDate(c.createdAt) }}</span>
        </button>
        <span v-if="candidates && !candidates.length" class="faint small">Keine weiteren offenen Vorgänge</span>
      </div>
    </div>

    <div class="field">
      <label for="merge-search">Anderen Vorgang suchen</label>
      <input id="merge-search" v-model="query" class="input" placeholder="Nummer oder Text" />
      <div v-if="query.trim()" class="results">
        <button
          v-for="r in results"
          :key="r.id"
          type="button"
          class="result"
          :class="{ chosen: chosen?.id === r.id }"
          :aria-pressed="chosen?.id === r.id"
          :disabled="otherReporter(r)"
          :title="otherReporter(r) ? 'Anderer Melder: nur verknüpfen (Bezieht sich auf)' : undefined"
          @click="chosen = r"
        >
          <span class="mono muted">{{ itemRef(r) }}</span>
          <span class="result-title">{{ r.title }}</span>
          <span class="faint small">{{ r.type ? TYPE_LABELS[r.type] : 'Eingang' }}</span>
          <span class="faint small">{{ r.reporter.name }}</span>
        </button>
        <span v-if="!results.length" class="faint small">Keine Treffer</span>
      </div>
    </div>

    <p class="faint small hint">
      Der bleibende Vorgang übernimmt alles: Meldung, Nachrichten und interne Notizen mit Anhängen. Der übernommene wird
      geschlossen und bleibt als «Duplikat von» verknüpft; Antworten auf seine Mails landen beim bleibenden. Zusammenführen
      geht nur bei gleichem Melder, Vorgänge verschiedener Melder lassen sich mit «Bezieht sich auf» verknüpfen.
    </p>
    <div v-if="chosen" class="outcome">
      <strong>{{ outcome }}</strong>
    </div>
    <div v-if="error" class="error-box">{{ error }}</div>

    <template #footer>
      <button class="btn" type="button" @click="emit('close')">Abbrechen</button>
      <button class="btn btn-primary" type="button" :disabled="!chosen || busy" @click="merge">Zusammenführen</button>
    </template>
  </ModalDialog>
</template>

<style scoped>
.small {
  font-size: 12px;
}
.hint {
  margin: 0;
}
.results {
  display: flex;
  flex-direction: column;
  gap: 2px;
  max-height: 220px;
  overflow-y: auto;
}
.result {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 8px;
  border: 1px solid transparent;
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
.result:disabled {
  cursor: not-allowed;
  opacity: 0.55;
}
.result:disabled:hover {
  background: none;
}
.result.chosen {
  background: var(--accent-soft);
  border-color: var(--accent);
}
.result-title {
  flex: 1;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.outcome {
  display: flex;
  flex-direction: column;
  gap: 4px;
  font-size: 13px;
}
</style>
