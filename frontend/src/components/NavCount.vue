<script setup lang="ts">
import { computed, ref } from 'vue';
import { segmentsText, type CountSegment } from '../nav-counts';

/**
 * Zähler je Status im Menü (Entscheid vom 03.11.2026): ein Feld je offener Status in seiner Farbe (halb so kräftig wie
 * die Statusfarbe), ohne Vorgänge blass. Beim Darüberfahren eine Liste mit Status und Anzahl. Ohne offene Vorgänge
 * eine blasse 0 wie bisher.
 */
const props = defineProps<{ segments: CountSegment[] }>();
const total = computed(() => props.segments.reduce((sum, s) => sum + s.count, 0));
const description = computed(() => segmentsText(props.segments));

const group = ref<HTMLElement | null>(null);
const popup = ref<HTMLElement | null>(null);
const pos = ref({ top: 0, left: 0 });

// Die Liste liegt fest über der Seite (die Tabs scrollen auf schmalen Bildschirmen), im Fenster gehalten
function place() {
  const r = group.value?.getBoundingClientRect();
  if (!r || !popup.value) return;
  const left = Math.max(8, Math.min(r.left - 8, window.innerWidth - popup.value.offsetWidth - 8));
  pos.value = { top: r.bottom + 8, left };
}
</script>

<template>
  <span v-if="!total" class="nav-count zero">0</span>
  <span v-else ref="group" class="nav-count segmented-count" role="img" :aria-label="description" @mouseenter="place">
    <span class="segs">
      <span
        v-for="s in segments"
        :key="s.statusId"
        class="seg"
        :class="{ empty: !s.count }"
        :style="{ '--seg': `var(--st-${s.color})` }"
        >{{ s.count }}</span
      >
    </span>
    <span ref="popup" class="count-popup" aria-hidden="true" :style="{ top: `${pos.top}px`, left: `${pos.left}px` }">
      <span v-for="s in segments" :key="s.statusId" class="popup-row">
        <span class="dot" :style="{ background: `var(--st-${s.color})` }" />
        <span class="popup-label">{{ s.label }}</span>
        <span class="popup-count">{{ s.count }}</span>
      </span>
      <span class="popup-row popup-total">
        <span class="popup-label">Offen</span>
        <span class="popup-count">{{ total }}</span>
      </span>
    </span>
  </span>
</template>

<style scoped>
.nav-count {
  display: inline-flex;
  font-size: 12px;
  font-weight: 600;
}
.segs {
  display: inline-flex;
  gap: 2px;
}
.zero,
.seg {
  min-width: 20px;
  height: 20px;
  padding: 0 6px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
}
.zero {
  border-radius: 10px;
  background: var(--surface-2);
  color: var(--text-faint);
}
/* Halbe Stärke der Statusfarbe, Schrift in dunkler Statusfarbe, im dunklen Schema weiss (--count-ink in styles.css) */
.seg {
  border-radius: 3px;
  background: color-mix(in srgb, var(--seg) 50%, var(--surface));
  color: color-mix(in srgb, var(--seg) var(--count-ink-share), var(--count-ink));
}
.seg:first-child {
  border-top-left-radius: 10px;
  border-bottom-left-radius: 10px;
}
.seg:last-child {
  border-top-right-radius: 10px;
  border-bottom-right-radius: 10px;
}
.seg.empty {
  background: var(--surface-2);
  color: var(--text-faint);
}
.count-popup {
  position: fixed;
  z-index: 300;
  display: flex;
  flex-direction: column;
  min-width: 180px;
  padding: 8px 10px;
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  background: var(--surface);
  box-shadow: var(--shadow-lg);
  color: var(--text);
  font-weight: 400;
  line-height: 1.7;
  visibility: hidden;
  opacity: 0;
  transition: opacity 0.12s;
  pointer-events: none;
}
.segmented-count:hover .count-popup {
  visibility: visible;
  opacity: 1;
}
.popup-row {
  display: flex;
  align-items: center;
  gap: 8px;
}
.dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  flex-shrink: 0;
}
.popup-label {
  flex: 1;
  white-space: nowrap;
}
.popup-count {
  font-weight: 600;
}
.popup-total {
  margin-top: 4px;
  padding-top: 4px;
  border-top: 1px solid var(--border);
  color: var(--text-muted);
}
</style>
