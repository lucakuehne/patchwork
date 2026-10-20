<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue';
import { api, errorMessage } from '../api';
import { useDebounced } from '../composables';
import { ROLE_LABELS } from '../format';
import type { PersonHit, PersonPick } from '../types';

/**
 * Personensuche für Melder und Beteiligte: Benutzer und Kontakte aus Patchwork (Name, E-Mail) und
 * Konten aus dem AD (Name, Benutzername, E-Mail). Eine unbekannte E-Mail-Adresse lässt sich als neuer
 * Kontakt wählen. Bedienung auch mit Pfeiltasten und Enter.
 * «directoryOnly»: nur Konten aus dem AD, ohne neue Kontakte (Benutzer vorab anlegen).
 */
const props = defineProps<{
  placeholder?: string;
  exclude?: string[];
  floating?: boolean;
  autofocus?: boolean;
  directoryOnly?: boolean;
}>();
const emit = defineEmits<{ pick: [person: PersonPick] }>();

const input = ref<HTMLInputElement | null>(null);
const query = ref('');
const debounced = useDebounced(query, 250);
const hits = ref<PersonHit[]>([]);
const searchedFor = ref('');
const directoryError = ref<string | null>(null);
const searchError = ref('');
const loading = ref(false);
const highlighted = ref(0);
const focused = ref(false);
let requestNo = 0;

onMounted(() => {
  if (props.autofocus) input.value?.focus();
});

const isEmail = (s: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s);

watch(debounced, async (value) => {
  const q = value.trim();
  const no = ++requestNo;
  if (!q) {
    hits.value = [];
    searchedFor.value = '';
    directoryError.value = null;
    loading.value = false;
    return;
  }
  loading.value = true;
  try {
    const result = await api.get<{ people: PersonHit[]; directoryError: string | null }>(
      `/people/search?q=${encodeURIComponent(q)}${props.directoryOnly ? '&scope=directory' : ''}`,
    );
    if (no !== requestNo) return; // inzwischen wurde weiter getippt
    hits.value = result.people;
    directoryError.value = result.directoryError;
    searchError.value = '';
    searchedFor.value = q;
    highlighted.value = 0;
  } catch (err) {
    if (no === requestNo) searchError.value = errorMessage(err);
  } finally {
    if (no === requestNo) loading.value = false;
  }
});

const excluded = computed(() => new Set((props.exclude ?? []).map((e) => e.toLowerCase())));
const visibleHits = computed(() => hits.value.filter((h) => !excluded.value.has(h.email)));
const newEmail = computed(() => {
  const typed = query.value.trim().toLowerCase();
  return !props.directoryOnly &&
    isEmail(typed) && !hits.value.some((h) => h.email === typed) && !excluded.value.has(typed) ? typed : null;
});
const options = computed<{ key: string; pick: PersonPick; hit: PersonHit | null }[]>(() => [
  ...visibleHits.value.map((hit) => ({
    key: hit.email,
    pick: { id: hit.id, name: hit.name, email: hit.email, role: hit.role },
    hit,
  })),
  ...(newEmail.value ? [{ key: `neu:${newEmail.value}`, pick: { id: null, name: '', email: newEmail.value, role: null }, hit: null }] : []),
]);
const showList = computed(() => !!query.value.trim() && (!props.floating || focused.value));

function pick(person: PersonPick) {
  emit('pick', person);
  query.value = '';
  hits.value = [];
  searchedFor.value = '';
}

function move(step: number) {
  if (options.value.length === 0) return;
  highlighted.value = (highlighted.value + step + options.value.length) % options.value.length;
}

function pickHighlighted() {
  const option = options.value[highlighted.value];
  if (option && !loading.value) pick(option.pick);
}
</script>

<template>
  <div class="person-search" :class="{ floating }">
    <input
      ref="input"
      v-model="query"
      class="input"
      :placeholder="placeholder ?? 'Name, Benutzername oder E-Mail'"
      autocomplete="off"
      @focus="focused = true"
      @blur="focused = false"
      @keydown.down.prevent="move(1)"
      @keydown.up.prevent="move(-1)"
      @keydown.enter.prevent="pickHighlighted"
      @keydown.esc="query = ''"
    />
    <div v-if="showList" class="results" :class="{ card: floating }">
      <button
        v-for="(option, i) in options"
        :key="option.key"
        type="button"
        class="option"
        :class="{ active: i === highlighted }"
        @mousedown.prevent
        @mouseenter="highlighted = i"
        @click="pick(option.pick)"
      >
        <template v-if="option.hit">
          <span class="line">
            <span class="name">{{ option.hit.name }}</span>
            <span v-if="option.hit.source === 'directory' && !directoryOnly" class="badge-ad" title="Aus dem AD, noch nicht in Patchwork">AD</span>
            <span v-if="option.hit.source === 'patchwork' && option.hit.role && directoryOnly" class="sub">
              in Patchwork: {{ ROLE_LABELS[option.hit.role] }}
            </span>
          </span>
          <span class="sub">
            {{ option.hit.email }}<template v-if="option.hit.username"> · {{ option.hit.username }}</template>
          </span>
        </template>
        <span v-else class="line">+ Neuer Kontakt «{{ option.pick.email }}»</span>
      </button>
      <div v-if="loading && !options.length" class="hint">Suche …</div>
      <div v-else-if="searchedFor && !options.length && hits.length" class="hint">Bereits eingetragen</div>
      <div v-else-if="searchedFor && !options.length && directoryOnly" class="hint">
        {{ searchedFor.length < 2 ? 'Bitte mindestens 2 Zeichen eingeben.' : 'Keine Treffer im AD.' }}
      </div>
      <div v-else-if="searchedFor && !options.length" class="hint">
        Keine Treffer. Für eine neue Person die E-Mail-Adresse eingeben.
      </div>
      <div v-if="directoryError" class="hint warn">{{ directoryError }}</div>
      <div v-if="searchError" class="hint warn">{{ searchError }}</div>
    </div>
  </div>
</template>

<style scoped>
.person-search {
  position: relative;
}
.results {
  margin-top: 6px;
  max-height: 260px;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
}
.floating .results {
  position: absolute;
  z-index: 300;
  top: 100%;
  left: 0;
  right: 0;
  min-width: 260px;
  padding: 6px;
  margin-top: 4px;
  box-shadow: var(--shadow-lg);
}
.option {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 1px;
  text-align: left;
  padding: 6px 8px;
  border: none;
  background: none;
  border-radius: var(--radius-sm);
  color: var(--text);
  font: inherit;
  cursor: pointer;
  min-width: 0;
}
.option.active {
  background: var(--surface-hover);
}
.line {
  display: flex;
  align-items: center;
  gap: 6px;
  max-width: 100%;
}
.name {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.sub {
  font-size: 12px;
  color: var(--text-faint);
  max-width: 100%;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.badge-ad {
  font-size: 10px;
  font-weight: 700;
  padding: 0 5px;
  border-radius: 999px;
  background: var(--accent-soft);
  color: var(--accent);
  flex-shrink: 0;
}
.hint {
  padding: 6px 8px;
  font-size: 13px;
  color: var(--text-faint);
}
.hint.warn {
  color: var(--warning);
}
</style>
