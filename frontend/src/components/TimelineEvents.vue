<script setup lang="ts">
import { computed } from 'vue';
import { formatDateTime } from '../format';
import { renderMarkdown } from '../markdown';
import { asListItem, authorName, automaticStatusText, eventPart, type EventPart } from '../timeline';
import type { Entry } from '../types';
import ItemLink from './ItemLink.vue';
import TimelineHead from './TimelineHead.vue';

/**
 * Graue Karte mit einer oder mehreren Änderungen kurz hintereinander von derselben Person (neueste zuerst):
 * oben Bearbeiter und Zeitpunkt, darunter die Änderungen als Liste.
 */
const props = defineProps<{ entries: Entry[] }>();

const latest = computed(() => props.entries[0]!);
// Von einer Regel: «Regel «Name»» mit den gespeicherten Änderungen
const rule = computed(() => (props.entries.length === 1 && latest.value.meta?.field === 'rule' ? latest.value.meta : null));
const author = computed(() => (rule.value ? `Regel «${String(rule.value.ruleName)}»` : (authorName(latest.value) ?? 'System')));
const automatic = computed(() => (props.entries.length === 1 ? automaticStatusText(latest.value) : null));
// In der Liste in zeitlicher Reihenfolge
const parts = computed<EventPart[]>(() => {
  if (automatic.value) return [{ text: automatic.value, link: null }];
  if (rule.value) return ((rule.value.changes as string[] | undefined) ?? []).map((text) => ({ text, link: null }));
  return [...props.entries].reverse().map(eventPart);
});
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
  <div class="events">
    <TimelineHead :name="author" :system="!!rule || !authorName(latest)" :time="latest.createdAt" :time-title="times" />
    <ul class="changes">
      <li v-for="(part, i) in parts" :key="i">
        {{ asListItem(part.text)
        }}<ItemLink v-if="part.link && !part.link.hidden" class="other" :item-key="part.link" :type="part.link.type">{{
          part.link.text
        }}</ItemLink
        ><span v-else-if="part.link" class="other" title="Kein Zugriff auf diesen Bereich">{{ part.link.text }}</span>
      </li>
    </ul>
    <div v-if="rejection" class="reason prose" v-html="rejection" />
  </div>
</template>

<style scoped>
.events {
  background: var(--surface-2);
  border: 1px solid var(--border);
  border-radius: var(--radius);
  padding: 8px 12px;
  font-size: 13px;
  color: var(--text-muted);
}
.changes {
  margin: 0;
  padding-left: 18px;
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.other {
  margin-left: 0.3em;
}
.reason {
  margin-top: 8px;
  padding: 8px 10px;
  border-left: 3px solid var(--danger);
  background: var(--danger-soft);
  border-radius: 0 var(--radius-sm) var(--radius-sm) 0;
  color: var(--text);
}
</style>
