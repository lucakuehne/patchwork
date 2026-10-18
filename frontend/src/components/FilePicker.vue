<script setup lang="ts">
import { ref } from 'vue';
import { formatSize } from '../format';

/** Auswahl von Anhängen per Button oder Drag & Drop. */
withDefaults(defineProps<{ compact?: boolean }>(), { compact: false });
const files = defineModel<File[]>({ required: true });

const input = ref<HTMLInputElement | null>(null);
const dragging = ref(false);
// Zähler, weil dragleave auch beim Wechsel auf Kindelemente feuert
let depth = 0;

function add(list: FileList | null | undefined) {
  if (!list?.length) return;
  files.value = [...files.value, ...Array.from(list)];
}

function onChange(e: Event) {
  add((e.target as HTMLInputElement).files);
  if (input.value) input.value.value = '';
}

function onEnter() {
  depth++;
  dragging.value = true;
}

function onLeave() {
  depth = Math.max(0, depth - 1);
  if (depth === 0) dragging.value = false;
}

function onDrop(e: DragEvent) {
  depth = 0;
  dragging.value = false;
  add(e.dataTransfer?.files);
}

function remove(index: number) {
  files.value = files.value.filter((_, i) => i !== index);
}
</script>

<template>
  <div
    class="file-picker"
    :class="{ dragging, compact }"
    @dragenter.prevent="onEnter"
    @dragover.prevent
    @dragleave.prevent="onLeave"
    @drop.prevent="onDrop"
  >
    <div class="row">
      <button class="btn btn-sm" type="button" @click="input?.click()">📎 Dateien anhängen</button>
      <span class="faint hint">oder hierher ziehen</span>
      <input ref="input" type="file" multiple hidden @change="onChange" />
    </div>
    <div v-if="files.length" class="files">
      <span v-for="(f, i) in files" :key="`${f.name}-${i}`" class="file">
        <span class="name" :title="f.name">{{ f.name }}</span>
        <span class="faint size">{{ formatSize(f.size) }}</span>
        <button type="button" class="remove" :aria-label="`${f.name} entfernen`" @click="remove(i)">✕</button>
      </span>
    </div>
  </div>
</template>

<style scoped>
.file-picker {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 8px;
  border: 1px dashed var(--border-strong);
  border-radius: var(--radius-sm);
  background: var(--surface);
  transition:
    border-color 0.12s,
    background 0.12s;
}
.file-picker.compact {
  padding: 0;
  border: none;
  background: transparent;
}
.file-picker.dragging {
  border-color: var(--accent);
  background: var(--accent-soft);
}
.hint {
  font-size: 12px;
}
.files {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}
.file {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  max-width: 300px;
  height: 26px;
  padding: 0 4px 0 8px;
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  background: var(--surface-2);
  font-size: 13px;
}
.name {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.size {
  font-size: 12px;
  white-space: nowrap;
}
.remove {
  border: none;
  background: none;
  color: var(--text-muted);
  cursor: pointer;
  padding: 0 4px;
  font-size: 12px;
}
.remove:hover {
  color: var(--danger);
}
</style>
