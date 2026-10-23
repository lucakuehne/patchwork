<script setup lang="ts">
import { ref } from 'vue';
import { mailAttachmentUrls, previewKind } from '../attachment-preview';
import { formatSize } from '../format';
import AttachmentPreview from './AttachmentPreview.vue';

/**
 * Anhänge einer gespeicherten Mail (Originalmail, versendete Mail, Protokolle): Bilder, Text, PDF und Mails öffnen sich
 * in der Vorschau, die übrigen werden heruntergeladen. «path»: Adresse eines Anhangs ohne Abfrage, «query» z.B.
 * «?messageId=…».
 */
const props = withDefaults(
  defineProps<{
    attachments: { index: number; filename: string; contentType: string; size: number }[];
    path: (index: number) => string;
    query?: string;
  }>(),
  { query: '' },
);

const previewing = ref<(typeof props.attachments)[number] | null>(null);

function open(a: (typeof props.attachments)[number], event: MouseEvent) {
  if (!previewKind(a) || event.ctrlKey || event.metaKey || event.shiftKey || event.button !== 0) return;
  event.preventDefault();
  previewing.value = a;
}
</script>

<template>
  <div v-if="attachments.length" class="stack attachments">
    <h3>Anhänge</h3>
    <a v-for="a in attachments" :key="a.index" :href="`${path(a.index)}${query}`" @click="open(a, $event)">
      {{ a.filename }} <span class="faint">({{ formatSize(a.size) }})</span>
    </a>
    <AttachmentPreview
      v-if="previewing"
      :file="previewing"
      :urls="mailAttachmentUrls(path(previewing.index), query)"
      @close="previewing = null"
    />
  </div>
</template>

<style scoped>
.attachments {
  gap: 4px;
}
</style>
