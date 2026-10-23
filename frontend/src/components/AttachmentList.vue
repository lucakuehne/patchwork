<script setup lang="ts">
import { computed, ref } from 'vue';
import { previewKind, type PreviewUrls } from '../attachment-preview';
import { formatSize } from '../format';
import { imagesInText } from '../markdown';
import type { Attachment } from '../types';
import AttachmentPreview from './AttachmentPreview.vue';

/**
 * base: Adresse der Anhänge, im Portal «/api/portal/attachments».
 * text: Markdown des Eintrags; Bilder, die dort im Text stehen, erscheinen nicht noch einmal als Anhang.
 * html: HTML einer Mail (z.B. ursprüngliche Meldung); darin eingebettete Bilder ebenso nicht.
 * Bilder, Text, PDF und Mails öffnen sich in einem Vorschaufenster, die übrigen werden heruntergeladen.
 */
const props = withDefaults(defineProps<{ attachments: Attachment[]; base?: string; text?: string; html?: string | null }>(), {
  base: '/api/attachments',
  text: '',
  html: null,
});
const listed = computed(() => {
  const inText = imagesInText(props.text);
  const html = props.html ?? '';
  return props.attachments.filter((a) => !inText.has(a.id) && !html.includes(`/attachments/${a.id}/inline`));
});
const isImage = (a: Attachment) => /^image\/(png|jpe?g|gif|webp|bmp)$/i.test(a.contentType);

const previewing = ref<Attachment | null>(null);
const urls = (a: Attachment): PreviewUrls => ({
  download: `${props.base}/${a.id}`,
  inline: `${props.base}/${a.id}/inline`,
  preview: `${props.base}/${a.id}/preview`,
  nested: (index) => `${props.base}/${a.id}/mail-attachments/${index}`,
});

function open(a: Attachment, event: MouseEvent) {
  // Mit Ctrl/Cmd oder mittlerer Taste wie ein gewöhnlicher Link (herunterladen)
  if (!previewKind(a) || event.ctrlKey || event.metaKey || event.shiftKey || event.button !== 0) return;
  event.preventDefault();
  previewing.value = a;
}
</script>

<template>
  <div v-if="listed.length" class="attachments">
    <a
      v-for="a in listed"
      :key="a.id"
      class="attachment"
      :href="`${base}/${a.id}`"
      :title="`${a.filename} (${formatSize(a.size)})${previewKind(a) ? ' – Vorschau' : ''}`"
      @click="open(a, $event)"
    >
      <img v-if="isImage(a)" :src="`${base}/${a.id}/inline`" alt="" class="thumb" loading="lazy" />
      <span v-else class="file-icon">📄</span>
      <span class="name">{{ a.filename }}</span>
      <span class="faint size">{{ formatSize(a.size) }}</span>
    </a>
    <AttachmentPreview v-if="previewing" :file="previewing" :urls="urls(previewing)" @close="previewing = null" />
  </div>
</template>

<style scoped>
.attachments {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin-top: 10px;
}
.attachment {
  display: flex;
  align-items: center;
  gap: 6px;
  max-width: 280px;
  padding: 4px 8px 4px 4px;
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  background: var(--surface-2);
  color: var(--text);
  font-size: 13px;
  text-decoration: none;
}
.attachment:hover {
  border-color: var(--accent);
  text-decoration: none;
}
.thumb {
  width: 32px;
  height: 32px;
  object-fit: cover;
  border-radius: 4px;
}
.file-icon {
  width: 24px;
  text-align: center;
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
</style>
