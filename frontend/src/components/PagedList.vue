<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { api } from '../api';
import { useDebounced } from '../composables';
import { useToast } from '../stores/toast';
import { EMPTY_FILTERS, listParams, type ListFilterValues, type ListSort } from '../list-filters';
import type { ItemSummary, View } from '../types';
import ItemTable from './ItemTable.vue';

/** Liste mit Suche und Blättern, z.B. für abgeschlossene Vorgänge. */
const props = defineProps<{
  view: View;
  mine: boolean;
  initialQuery?: string;
  showType?: boolean;
  showStatus?: boolean;
  showClosed?: boolean;
  hideSearch?: boolean;
  emptyText?: string;
  /** Filter der Liste (siehe ListFilters) */
  filters?: ListFilterValues;
}>();
/** Sortierung per Spaltenkopf (v-model:sort); ohne bleibt die Reihenfolge der Ansicht */
const sort = defineModel<ListSort | null>('sort');

const toast = useToast();
const PAGE = 50;
const query = ref(props.initialQuery ?? '');
const debounced = useDebounced(query);
const items = ref<ItemSummary[]>([]);
const total = ref(0);
const offset = ref(0);
const loading = ref(true);

async function load() {
  loading.value = true;
  try {
    const params = new URLSearchParams({
      view: props.view,
      mine: props.mine ? '1' : '0',
      q: debounced.value.trim(),
      limit: String(PAGE),
      offset: String(offset.value),
      ...listParams(props.filters ?? EMPTY_FILTERS, sort.value ?? null),
    });
    const result = await api.get<{ items: ItemSummary[]; total: number }>(`/items?${params}`);
    items.value = result.items;
    total.value = result.total;
  } catch (err) {
    toast.error(err);
  } finally {
    loading.value = false;
  }
}

watch(
  () => [props.view, props.mine, debounced.value, JSON.stringify(props.filters), JSON.stringify(sort.value)],
  () => {
    offset.value = 0;
    void load();
  },
  { immediate: true },
);
watch(
  () => props.initialQuery,
  (q) => (query.value = q ?? ''),
);

const from = computed(() => (total.value === 0 ? 0 : offset.value + 1));
const to = computed(() => Math.min(offset.value + PAGE, total.value));
function page(delta: number) {
  offset.value = Math.max(0, offset.value + delta * PAGE);
  void load();
}
</script>

<template>
  <div class="stack">
    <div v-if="!hideSearch" class="row">
      <input v-model="query" class="input search" type="search" placeholder="In dieser Ansicht suchen" />
    </div>
    <ItemTable
      v-if="!loading || items.length"
      :items="items"
      :show-type="showType"
      :show-status="showStatus"
      :show-closed="showClosed"
      :empty-text="emptyText"
      :sort="sort === undefined ? undefined : sort"
      @update:sort="sort = $event"
    />
    <div v-if="total > PAGE" class="row">
      <span class="muted">{{ from }}–{{ to }} von {{ total }}</span>
      <div class="spacer" />
      <button class="btn btn-sm" type="button" :disabled="offset === 0" @click="page(-1)">Zurück</button>
      <button class="btn btn-sm" type="button" :disabled="to >= total" @click="page(1)">Weiter</button>
    </div>
  </div>
</template>

<style scoped>
.search {
  max-width: 360px;
}
</style>
