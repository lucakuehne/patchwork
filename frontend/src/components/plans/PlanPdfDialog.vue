<script setup lang="ts">
import { onMounted, ref } from 'vue';
import type { PdfPages } from '../../plans/pdf';
import ModalDialog from '../ModalDialog.vue';

/** PDF mit mehreren Seiten: welche Seite ist der Plan? Vorschau jeder Seite (höchstens 24). */
const props = defineProps<{ pdf: PdfPages; fileName: string }>();
const emit = defineEmits<{ choose: [page: number]; close: [] }>();

const MAX = 24;
const thumbs = ref<(string | null)[]>([]);
const chosen = ref(1);

onMounted(async () => {
  const count = Math.min(props.pdf.count, MAX);
  thumbs.value = Array.from({ length: count }, () => null);
  for (let page = 1; page <= count; page++) {
    try {
      thumbs.value[page - 1] = await props.pdf.thumbnail(page);
    } catch {
      // Ohne Vorschau bleibt die Seite trotzdem wählbar
    }
  }
});
</script>

<template>
  <ModalDialog :title="`Seite wählen: ${fileName}`" wide @close="emit('close')">
    <p class="hint">Das PDF hat {{ pdf.count }} Seiten. Welche ist der Plan des Stockwerks?</p>
    <div class="pages" role="radiogroup" aria-label="Seite">
      <button
        v-for="(src, i) in thumbs"
        :key="i"
        type="button"
        role="radio"
        class="page"
        :class="{ active: chosen === i + 1 }"
        :aria-checked="chosen === i + 1"
        @click="chosen = i + 1"
        @dblclick="emit('choose', i + 1)"
      >
        <img v-if="src" :src="src" :alt="`Seite ${i + 1}`" />
        <span v-else class="placeholder">…</span>
        <span>Seite {{ i + 1 }}</span>
      </button>
    </div>
    <p v-if="pdf.count > MAX" class="hint">Es werden die ersten {{ MAX }} Seiten gezeigt.</p>
    <template #footer>
      <button class="btn" type="button" @click="emit('close')">Abbrechen</button>
      <button class="btn btn-primary" type="button" @click="emit('choose', chosen)">Seite {{ chosen }} übernehmen</button>
    </template>
  </ModalDialog>
</template>

<style scoped>
.pages {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(140px, 1fr));
  gap: 10px;
}
.page {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 4px;
  padding: 6px;
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  background: var(--surface);
  cursor: pointer;
  font: inherit;
  color: var(--text);
}
.page.active {
  border-color: var(--accent);
  box-shadow: inset 0 0 0 1px var(--accent);
  background: var(--accent-soft);
}
.page img {
  max-width: 100%;
  border: 1px solid var(--border);
  background: #ffffff;
}
.placeholder {
  height: 120px;
  display: grid;
  place-items: center;
  color: var(--text-faint);
}
</style>
