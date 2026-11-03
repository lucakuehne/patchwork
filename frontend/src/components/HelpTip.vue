<script setup lang="ts">
import { ref, useId } from 'vue';

/**
 * «?» mit einer Erklärung beim Darüberfahren, Antippen oder per Tastatur (Fokus); «label» für Screenreader, Text im Slot.
 * Die Erklärung liegt fest über der Seite (auch in Tabellen mit eigenem Bildlauf nicht abgeschnitten): unter dem «?»,
 * im Fenster gehalten, unten zu knapp darüber.
 */
defineProps<{ label: string }>();
const id = useId();
const icon = ref<HTMLButtonElement | null>(null);
const tip = ref<HTMLElement | null>(null);
const pos = ref({ top: 0, left: 0 });

const MARGIN = 8;

function place() {
  const r = icon.value?.getBoundingClientRect();
  if (!r || !tip.value) return;
  const { offsetWidth: width, offsetHeight: height } = tip.value;
  const left = Math.max(MARGIN, Math.min(r.left - MARGIN, window.innerWidth - width - MARGIN));
  const below = r.bottom + 6;
  const top = below + height > window.innerHeight - MARGIN && r.top - 6 - height > MARGIN ? r.top - 6 - height : below;
  pos.value = { top, left };
}
</script>

<template>
  <span class="help-tip" @mouseenter="place" @focusin="place" @click.stop>
    <button ref="icon" type="button" class="help-icon" :aria-label="label" :aria-describedby="id">?</button>
    <span :id="id" ref="tip" role="tooltip" class="help-text" :style="{ top: `${pos.top}px`, left: `${pos.left}px` }"><slot /></span>
  </span>
</template>

<style scoped>
.help-tip {
  position: relative;
  display: inline-flex;
  vertical-align: middle;
}
.help-icon {
  width: 16px;
  height: 16px;
  padding: 0;
  border: 1px solid var(--border-strong);
  border-radius: 50%;
  background: var(--surface);
  color: var(--text-muted);
  font: inherit;
  font-size: 11px;
  font-weight: 600;
  line-height: 1;
  cursor: help;
  display: inline-flex;
  align-items: center;
  justify-content: center;
}
.help-icon:hover,
.help-icon:focus-visible {
  border-color: var(--accent);
  color: var(--accent);
}
.help-text {
  position: fixed;
  /* über Kopfzeile und Dialogen, wie die Auswahllisten */
  z-index: 300;
  width: max-content;
  max-width: 280px;
  padding: 8px 10px;
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  background: var(--surface);
  box-shadow: var(--shadow-lg);
  color: var(--text);
  font-size: 12px;
  font-weight: 400;
  line-height: 1.45;
  text-align: left;
  white-space: normal;
  visibility: hidden;
  opacity: 0;
  transition: opacity 0.12s;
  pointer-events: none;
}
.help-tip:hover .help-text,
.help-icon:focus + .help-text {
  visibility: visible;
  opacity: 1;
}
</style>
