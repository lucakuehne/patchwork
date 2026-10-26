<script setup lang="ts">
import { computed, watch } from 'vue';
import { PRIORITY_LABELS } from '../format';
import { activeFilters, EMPTY_FILTERS, validFilters, type ListFilterValues } from '../list-filters';
import { useSession } from '../stores/session';
import type { Priority } from '../types';

/**
 * Filterleiste einer Liste bzw. des Boards: Priorität, Zuständig, Meldeweg und, wo es mehrere gibt, Status.
 * «mine»: Mit «Nur meine» ist Zuständig schon festgelegt. Gespeicherte Werte, die es nicht mehr gibt, fallen weg.
 */
const props = defineProps<{ statuses?: { id: string; label: string }[]; mine?: boolean }>();
const filters = defineModel<ListFilterValues>({ required: true });
const session = useSession();

const priorities = Object.entries(PRIORITY_LABELS) as [Priority, string][];
const channels = computed(() => [...session.channels].sort((a, b) => a.label.localeCompare(b.label, 'de')));
const showStatus = computed(() => (props.statuses?.length ?? 0) > 1);

watch(
  () => [session.staff, session.channels, props.statuses] as const,
  () => {
    if (!session.staff.length || !session.channels.length) return;
    const valid = validFilters(filters.value, {
      assignee: session.staff.map((u) => u.id),
      status: showStatus.value ? props.statuses!.map((s) => s.id) : [],
      channel: session.channels.map((c) => c.id),
    });
    if (JSON.stringify(valid) !== JSON.stringify(filters.value)) filters.value = valid;
  },
  { immediate: true },
);

const active = computed(() => activeFilters(filters.value));
const set = (key: keyof ListFilterValues, value: string) => (filters.value = { ...filters.value, [key]: value });
</script>

<template>
  <div class="list-filters" role="group" aria-label="Filter">
    <select
      class="select"
      :class="{ chosen: filters.priority }"
      aria-label="Priorität"
      :value="filters.priority"
      @change="set('priority', ($event.target as HTMLSelectElement).value)"
    >
      <option value="">Priorität: alle</option>
      <option v-for="[key, label] in priorities" :key="key" :value="key">Priorität: {{ label }}</option>
    </select>
    <select
      class="select"
      :class="{ chosen: filters.assignee && !mine }"
      aria-label="Zuständig"
      :value="mine ? '' : filters.assignee"
      :disabled="mine"
      :title="mine ? 'Mit «Nur meine» sind es deine Vorgänge' : undefined"
      @change="set('assignee', ($event.target as HTMLSelectElement).value)"
    >
      <option value="">Zuständig: alle</option>
      <option value="none">Zuständig: niemand</option>
      <option v-for="u in session.staff" :key="u.id" :value="u.id">Zuständig: {{ u.name }}</option>
    </select>
    <select
      v-if="showStatus"
      class="select"
      :class="{ chosen: filters.status }"
      aria-label="Status"
      :value="filters.status"
      @change="set('status', ($event.target as HTMLSelectElement).value)"
    >
      <option value="">Status: alle</option>
      <option v-for="s in statuses" :key="s.id" :value="s.id">Status: {{ s.label }}</option>
    </select>
    <select
      class="select"
      :class="{ chosen: filters.channel }"
      aria-label="Meldeweg"
      :value="filters.channel"
      @change="set('channel', ($event.target as HTMLSelectElement).value)"
    >
      <option value="">Meldeweg: alle</option>
      <option value="none">Meldeweg: ohne Angabe</option>
      <option v-for="c in channels" :key="c.id" :value="c.id">Meldeweg: {{ c.label }}</option>
    </select>
    <button v-if="active" class="link-btn small" type="button" @click="filters = { ...EMPTY_FILTERS }">
      Filter zurücksetzen
    </button>
  </div>
</template>

<style scoped>
.list-filters {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
}
.list-filters .select {
  width: auto;
  max-width: 240px;
}
/* Gesetzte Filter hervorgehoben, damit eine gefilterte Liste nicht als vollständig gilt */
.list-filters .select.chosen {
  border-color: var(--accent);
  background: var(--accent-soft);
}
.small {
  font-size: 13px;
}
</style>
