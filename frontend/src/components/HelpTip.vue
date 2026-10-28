<script setup lang="ts">
import { useId } from 'vue';

/** «?» mit einer Erklärung beim Darüberfahren, Antippen oder per Tastatur (Fokus); «label» für Screenreader, Text im Slot */
defineProps<{ label: string }>();
const id = useId();
</script>

<template>
  <span class="help-tip">
    <button type="button" class="help-icon" :aria-label="label" :aria-describedby="id">?</button>
    <span :id="id" role="tooltip" class="help-text"><slot /></span>
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
  position: absolute;
  top: calc(100% + 6px);
  left: -8px;
  z-index: 20;
  width: max-content;
  max-width: 260px;
  padding: 8px 10px;
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  background: var(--surface);
  box-shadow: var(--shadow-lg);
  color: var(--text);
  font-size: 12px;
  font-weight: 400;
  line-height: 1.45;
  visibility: hidden;
  opacity: 0;
  transition: opacity 0.12s;
}
.help-tip:hover .help-text,
.help-icon:focus + .help-text {
  visibility: visible;
  opacity: 1;
}
</style>
