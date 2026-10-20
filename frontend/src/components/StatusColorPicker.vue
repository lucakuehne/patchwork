<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref } from 'vue';
import { STATUS_COLORS } from '../status-colors';
import type { StatusColor } from '../types';

/** Auswahl der Farbe eines Status. */
const model = defineModel<StatusColor>({ required: true });
const open = ref(false);
const root = ref<HTMLElement | null>(null);
const label = (color: StatusColor) => STATUS_COLORS.find((c) => c.color === color)?.label ?? color;

function pick(color: StatusColor) {
  model.value = color;
  open.value = false;
}

function onDocClick(e: MouseEvent) {
  if (root.value && !root.value.contains(e.target as Node)) open.value = false;
}
onMounted(() => document.addEventListener('click', onDocClick));
onBeforeUnmount(() => document.removeEventListener('click', onDocClick));
</script>

<template>
  <div ref="root" class="color-picker">
    <button
      class="swatch current"
      :class="`st-${model}`"
      type="button"
      :title="`Farbe: ${label(model)}`"
      :aria-label="`Farbe: ${label(model)}`"
      :aria-expanded="open"
      @click="open = !open"
    />
    <div v-if="open" class="grid card" role="listbox" aria-label="Farbe">
      <button
        v-for="c in STATUS_COLORS"
        :key="c.color"
        type="button"
        class="swatch"
        :class="[`st-${c.color}`, { active: c.color === model }]"
        role="option"
        :aria-selected="c.color === model"
        :title="c.label"
        :aria-label="c.label"
        @click="pick(c.color)"
      />
    </div>
  </div>
</template>

<style scoped>
.color-picker {
  position: relative;
  flex-shrink: 0;
}
.swatch {
  width: 22px;
  height: 22px;
  border-radius: 50%;
  border: 2px solid var(--surface);
  box-shadow: 0 0 0 1px var(--border-strong);
  cursor: pointer;
  padding: 0;
  background: var(--sw-bg);
}
.swatch::after {
  content: '';
  display: block;
  width: 8px;
  height: 8px;
  margin: auto;
  border-radius: 50%;
  background: var(--sw-fg);
}
.swatch.active {
  box-shadow: 0 0 0 2px var(--accent);
}
.grid {
  position: absolute;
  z-index: 300;
  top: calc(100% + 4px);
  left: 0;
  display: grid;
  grid-template-columns: repeat(5, 22px);
  gap: 8px;
  padding: 10px;
  box-shadow: var(--shadow-lg);
}
.st-gray {
  --sw-bg: var(--st-gray-bg);
  --sw-fg: var(--st-gray);
}
.st-blue {
  --sw-bg: var(--st-blue-bg);
  --sw-fg: var(--st-blue);
}
.st-teal {
  --sw-bg: var(--st-teal-bg);
  --sw-fg: var(--st-teal);
}
.st-green {
  --sw-bg: var(--st-green-bg);
  --sw-fg: var(--st-green);
}
.st-yellow {
  --sw-bg: var(--st-yellow-bg);
  --sw-fg: var(--st-yellow);
}
.st-orange {
  --sw-bg: var(--st-orange-bg);
  --sw-fg: var(--st-orange);
}
.st-red {
  --sw-bg: var(--st-red-bg);
  --sw-fg: var(--st-red);
}
.st-pink {
  --sw-bg: var(--st-pink-bg);
  --sw-fg: var(--st-pink);
}
.st-purple {
  --sw-bg: var(--st-purple-bg);
  --sw-fg: var(--st-purple);
}
.st-brown {
  --sw-bg: var(--st-brown-bg);
  --sw-fg: var(--st-brown);
}
</style>
