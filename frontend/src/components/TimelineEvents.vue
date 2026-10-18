<script setup lang="ts">
import { computed } from 'vue';
import { formatDateTime } from '../format';
import { renderMarkdown } from '../markdown';
import { automaticStatusText, eventPart, type EventPart } from '../timeline';
import type { Entry } from '../types';

/** Eine Ereigniszeile: eine Änderung oder mehrere kurz hintereinander von derselben Person (neueste zuerst). */
const props = defineProps<{ entries: Entry[] }>();

const latest = computed(() => props.entries[0]!);
// Von einer Regel: «Regel «Name» hat …» mit den gespeicherten Änderungen
const rule = computed(() => (props.entries.length === 1 && latest.value.meta?.field === 'rule' ? latest.value.meta : null));
const author = computed(() => (rule.value ? `Regel «${String(rule.value.ruleName)}»` : (latest.value.author?.name ?? 'System')));
const automatic = computed(() => (props.entries.length === 1 ? automaticStatusText(latest.value) : null));
// In der Zeile in zeitlicher Reihenfolge
const parts = computed<EventPart[]>(() =>
  rule.value
    ? ((rule.value.changes as string[] | undefined) ?? []).map((text) => ({ text, link: null }))
    : [...props.entries].reverse().map(eventPart),
);
const rejection = computed(() => {
  const e = latest.value;
  return props.entries.length === 1 && e.kind === 'status' && e.meta?.rejected && e.body ? renderMarkdown(e.body) : '';
});
// Bei mehreren Änderungen die einzelnen Zeitpunkte beim Darüberfahren
const times = computed(() =>
  props.entries.length > 1
    ? [...props.entries]
        .reverse()
        .map((e) => formatDateTime(e.createdAt))
        .join(', ')
    : undefined,
);
</script>

<template>
  <div class="event">
    <span class="dot" />
    <span>
      <strong>{{ author }}</strong> <template v-if="automatic">{{ automatic }}</template>
      <template v-else>
        hat
        <template v-for="(part, i) in parts" :key="i">
          <span>{{ part.text }}<RouterLink v-if="part.link" class="other" :to="part.link.to">{{ part.link.text }}</RouterLink></span>
          <template v-if="i < parts.length - 2">, </template>
          <template v-else-if="i === parts.length - 2"> und </template>
        </template>
      </template>
      <span class="faint small" :title="times"> · {{ formatDateTime(latest.createdAt) }}</span>
    </span>
    <div v-if="rejection" class="reason prose" v-html="rejection" />
  </div>
</template>

<style scoped>
.event {
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  gap: 8px;
  padding: 2px 4px 2px 10px;
  color: var(--text-muted);
  font-size: 13px;
}
.dot {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: var(--border-strong);
  flex-shrink: 0;
  transform: translateY(-1px);
}
.other {
  margin-left: 0.3em;
}
.small {
  font-size: 12px;
}
.reason {
  flex-basis: 100%;
  margin-left: 15px;
  padding: 8px 10px;
  border-left: 3px solid var(--danger);
  background: var(--danger-soft);
  border-radius: 0 var(--radius-sm) var(--radius-sm) 0;
  color: var(--text);
}
</style>
