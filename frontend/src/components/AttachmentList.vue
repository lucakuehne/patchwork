<script setup lang="ts">
import { computed } from 'vue';
import { formatSize } from '../format';
import { imagesInText } from '../markdown';
import type { Attachment } from '../types';

/**
 * base: Adresse der Anhänge, im Portal «/api/portal/attachments».
 * text: Markdown des Eintrags; Bilder, die dort im Text stehen, erscheinen nicht noch einmal als Anhang.
 */
const props = withDefaults(defineProps<{ attachments: Attachment[]; base?: string; text?: string }>(), {
  base: '/api/attachments',
  text: '',
});
const listed = computed(() => {
  const inText = imagesInText(props.text);
  return props.attachments.filter((a) => !inText.has(a.id));
});
const isImage = (a: Attachment) => /^image\/(png|jpe?g|gif|webp|bmp)$/i.test(a.contentType);
</script>

<template>
  <div v-if="listed.length" class="attachments">
    <a
      v-for="a in listed"
      :key="a.id"
      class="attachment"
      :href="`${base}/${a.id}`"
      :title="`${a.filename} (${formatSize(a.size)})`"
    >
      <img v-if="isImage(a)" :src="`${base}/${a.id}/inline`" alt="" class="thumb" loading="lazy" />
      <span v-else class="file-icon">📄</span>
      <span class="name">{{ a.filename }}</span>
      <span class="faint size">{{ formatSize(a.size) }}</span>
    </a>
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
