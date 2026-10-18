<script setup lang="ts">
import { formatSize } from '../format';
import type { Attachment } from '../types';

/** base: Adresse der Anhänge, im Portal «/api/portal/attachments» */
withDefaults(defineProps<{ attachments: Attachment[]; base?: string }>(), { base: '/api/attachments' });
const isImage = (a: Attachment) => /^image\/(png|jpe?g|gif|webp|bmp)$/i.test(a.contentType);
</script>

<template>
  <div v-if="attachments.length" class="attachments">
    <a
      v-for="a in attachments"
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
