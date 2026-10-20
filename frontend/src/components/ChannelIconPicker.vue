<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref } from 'vue';
import type { ChannelIcon as Icon } from '../types';
import ChannelIcon from './ChannelIcon.vue';

/** Auswahl des Symbols für einen Meldeweg. */
const model = defineModel<Icon>({ required: true });

const ICONS: { icon: Icon; label: string }[] = [
  { icon: 'mail', label: 'Briefumschlag' },
  { icon: 'portal', label: 'Bildschirm' },
  { icon: 'phone', label: 'Telefon' },
  { icon: 'mobile', label: 'Handy' },
  { icon: 'person', label: 'Person' },
  { icon: 'chat', label: 'Sprechblase' },
  { icon: 'video', label: 'Videokamera' },
  { icon: 'letter', label: 'Dokument' },
  { icon: 'alert', label: 'Glocke' },
  { icon: 'other', label: 'Punkte' },
];

const open = ref(false);
const root = ref<HTMLElement | null>(null);

function pick(icon: Icon) {
  model.value = icon;
  open.value = false;
}

function onDocClick(e: MouseEvent) {
  if (root.value && !root.value.contains(e.target as Node)) open.value = false;
}
onMounted(() => document.addEventListener('click', onDocClick));
onBeforeUnmount(() => document.removeEventListener('click', onDocClick));
</script>

<template>
  <div ref="root" class="icon-picker">
    <button class="btn btn-sm current" type="button" title="Symbol wählen" :aria-expanded="open" @click="open = !open">
      <ChannelIcon :icon="model" />
    </button>
    <div v-if="open" class="grid card" role="listbox" aria-label="Symbol">
      <button
        v-for="i in ICONS"
        :key="i.icon"
        type="button"
        class="option"
        :class="{ active: i.icon === model }"
        role="option"
        :aria-selected="i.icon === model"
        :title="i.label"
        @click="pick(i.icon)"
      >
        <ChannelIcon :icon="i.icon" />
      </button>
    </div>
  </div>
</template>

<style scoped>
.icon-picker {
  position: relative;
}
.current {
  width: 32px;
  padding: 0;
  justify-content: center;
}
.grid {
  position: absolute;
  z-index: 300;
  top: calc(100% + 4px);
  left: 0;
  display: grid;
  grid-template-columns: repeat(5, 32px);
  gap: 4px;
  padding: 6px;
  box-shadow: var(--shadow-lg);
}
.option {
  width: 32px;
  height: 30px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border: 1px solid transparent;
  border-radius: var(--radius-sm);
  background: none;
  color: var(--text-muted);
  cursor: pointer;
}
.option:hover {
  background: var(--surface-hover);
  color: var(--text);
}
.option.active {
  background: var(--accent-soft);
  color: var(--accent);
  border-color: var(--accent-soft);
}
</style>
