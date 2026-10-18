<script setup lang="ts">
import type { ItemType } from '../types';

/** Auswahl des Typs beim Erfassen: zwei Karten mit Leitfrage. */
const model = defineModel<ItemType>({ required: true });

const options: { value: ItemType; label: string; hint: string }[] = [
  { value: 'incident', label: 'Störung', hint: 'Etwas funktioniert nicht mehr, das vorher ging' },
  { value: 'task', label: 'Aufgabe', hint: 'Etwas Neues oder Anderes soll gemacht werden' },
];
</script>

<template>
  <div class="type-choice" role="radiogroup" aria-label="Typ">
    <button
      v-for="o in options"
      :key="o.value"
      type="button"
      role="radio"
      class="option"
      :class="[`type-${o.value}`, { active: model === o.value }]"
      :aria-checked="model === o.value"
      @click="model = o.value"
    >
      <span class="label">{{ o.label }}</span>
      <span class="hint">{{ o.hint }}</span>
    </button>
  </div>
</template>

<style scoped>
.type-choice {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
  gap: 8px;
}
.option {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 2px;
  padding: 10px 12px;
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  background: var(--surface);
  color: var(--text);
  font: inherit;
  text-align: left;
  cursor: pointer;
  transition:
    border-color 0.12s,
    background 0.12s;
}
.option:hover {
  border-color: var(--border-strong);
}
.option.active {
  border-color: var(--accent);
  background: var(--accent-soft);
  box-shadow: inset 0 0 0 1px var(--accent);
}
.label {
  font-weight: 600;
}
.hint {
  font-size: 12px;
  color: var(--text-muted);
  line-height: 1.35;
}
</style>
