<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue';
import { api } from '../api';
import type { Snippet } from '../types';

/** Auswahl eines Textbausteins für das Antwortfeld. Ohne Textbausteine wird nichts angezeigt. */
const emit = defineEmits<{ pick: [snippet: Snippet] }>();

const snippets = ref<Snippet[]>([]);
const open = ref(false);
const filter = ref('');
const root = ref<HTMLElement | null>(null);

onMounted(async () => {
  try {
    snippets.value = await api.get<Snippet[]>('/snippets');
  } catch {
    snippets.value = [];
  }
});

const visible = computed(() => {
  const f = filter.value.trim().toLowerCase();
  return f ? snippets.value.filter((s) => s.name.toLowerCase().includes(f)) : snippets.value;
});

function pick(s: Snippet) {
  open.value = false;
  filter.value = '';
  emit('pick', s);
}

function onDocClick(e: MouseEvent) {
  if (root.value && !root.value.contains(e.target as Node)) open.value = false;
}
document.addEventListener('click', onDocClick);
onBeforeUnmount(() => document.removeEventListener('click', onDocClick));
</script>

<template>
  <div v-if="snippets.length" ref="root" class="snippet-picker">
    <button class="btn btn-sm" type="button" :aria-expanded="open" @click="open = !open">Textbaustein ▾</button>
    <div v-if="open" class="dropdown card" @keydown.esc="open = false">
      <input v-if="snippets.length > 6" v-model="filter" class="input" placeholder="Suchen …" autofocus />
      <button v-for="s in visible" :key="s.id" type="button" class="option" @click="pick(s)">{{ s.name }}</button>
      <div v-if="!visible.length" class="faint hint">Keine Treffer</div>
    </div>
  </div>
</template>

<style scoped>
.snippet-picker {
  position: relative;
}
.dropdown {
  position: absolute;
  z-index: 300;
  top: calc(100% + 4px);
  left: 0;
  min-width: 240px;
  max-height: 300px;
  overflow-y: auto;
  padding: 6px;
  display: flex;
  flex-direction: column;
  gap: 2px;
  box-shadow: var(--shadow-lg);
}
.option {
  text-align: left;
  padding: 6px 8px;
  border: none;
  background: none;
  border-radius: var(--radius-sm);
  color: var(--text);
  font: inherit;
  cursor: pointer;
}
.option:hover {
  background: var(--surface-hover);
}
.hint {
  padding: 6px 8px;
  font-size: 13px;
}
</style>
