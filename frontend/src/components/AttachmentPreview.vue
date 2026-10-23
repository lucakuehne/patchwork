<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { api, errorMessage } from '../api';
import { previewKind, type AttachmentPreviewData, type PreviewUrls } from '../attachment-preview';
import { formatDateTime, formatSize } from '../format';
import { renderMailHtml } from '../markdown';
import ModalDialog from './ModalDialog.vue';

/**
 * Anhang im Fenster anzeigen statt herunterladen: Bilder, PDF (Betrachter des Browsers), Text und Mails (.eml, .msg)
 * mit Kopf, Text und der Liste ihrer Anhänge. «Herunterladen» lädt die Datei wie bisher.
 */
const props = defineProps<{ file: { filename: string; contentType: string; size: number }; urls: PreviewUrls }>();
const emit = defineEmits<{ close: [] }>();

const kind = computed(() => previewKind(props.file));
const data = ref<AttachmentPreviewData | null>(null);
const error = ref('');
const needsData = computed(() => kind.value === 'text' || kind.value === 'mail');

onMounted(async () => {
  if (!needsData.value) return;
  try {
    // Die Adresse enthält schon «/api»
    data.value = await api.get<AttachmentPreviewData>(props.urls.preview.replace(/^\/api/, ''));
  } catch (err) {
    error.value = errorMessage(err);
  }
});
</script>

<template>
  <ModalDialog :title="file.filename" wide @close="emit('close')">
    <div v-if="error" class="error-box">{{ error }}</div>
    <div v-else-if="needsData && !data" class="faint">Lädt …</div>
    <div v-else-if="kind === 'image'" class="image-frame">
      <img :src="urls.inline" :alt="file.filename" class="preview-image" />
    </div>
    <iframe v-else-if="kind === 'pdf'" :src="urls.inline" class="pdf" :title="file.filename" />
    <template v-else-if="kind === 'text' && data">
      <pre class="text-preview">{{ data.text }}</pre>
      <p v-if="data.truncated" class="faint small">Gekürzt; die ganze Datei gibt es über «Herunterladen».</p>
    </template>
    <template v-else-if="kind === 'mail' && data?.mail">
      <dl class="headers">
        <dt>Betreff</dt>
        <dd>{{ data.mail.headers.subject || '–' }}</dd>
        <dt>Von</dt>
        <dd>{{ data.mail.headers.from || '–' }}</dd>
        <dt>An</dt>
        <dd>{{ data.mail.headers.to.join(', ') || '–' }}</dd>
        <template v-if="data.mail.headers.cc.length">
          <dt>CC</dt>
          <dd>{{ data.mail.headers.cc.join(', ') }}</dd>
        </template>
        <template v-if="data.mail.headers.date">
          <dt>Datum</dt>
          <dd>{{ formatDateTime(data.mail.headers.date) }}</dd>
        </template>
      </dl>
      <div v-if="data.mail.html" class="prose mail-html mail-body" v-html="renderMailHtml(data.mail.html)" />
      <pre v-else class="mail-body text-preview">{{ data.mail.text }}</pre>
      <div v-if="data.mail.attachments.length" class="stack nested">
        <h3>Anhänge</h3>
        <template v-for="a in data.mail.attachments" :key="a.index">
          <a v-if="urls.nested" :href="urls.nested(a.index)">
            {{ a.filename }} <span class="faint">({{ formatSize(a.size) }})</span>
          </a>
          <span v-else>
            {{ a.filename }} <span class="faint">({{ formatSize(a.size) }})</span>
          </span>
        </template>
      </div>
    </template>
    <template #footer>
      <a class="btn" :href="urls.download">Herunterladen</a>
      <button class="btn btn-primary" type="button" @click="emit('close')">Schliessen</button>
    </template>
  </ModalDialog>
</template>

<style scoped>
.image-frame {
  display: flex;
  justify-content: center;
  background: var(--surface-2);
  border-radius: var(--radius-sm);
  padding: 8px;
}
.preview-image {
  max-width: 100%;
  max-height: 70vh;
  object-fit: contain;
}
.pdf {
  width: 100%;
  height: 75vh;
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  background: var(--surface-2);
}
.text-preview {
  margin: 0;
  max-height: 70vh;
  overflow: auto;
  padding: 10px 12px;
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  background: var(--surface-2);
  font-family: var(--mono);
  font-size: 12px;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}
.headers {
  display: grid;
  grid-template-columns: max-content 1fr;
  gap: 4px 12px;
  margin: 0;
}
.headers dt {
  color: var(--text-muted);
}
.headers dd {
  margin: 0;
  overflow-wrap: anywhere;
}
.mail-body {
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  padding: 12px;
  max-height: 55vh;
  overflow: auto;
}
.mail-body.text-preview {
  font-family: var(--font);
  font-size: 14px;
  background: none;
}
.nested {
  gap: 4px;
}
.small {
  font-size: 12px;
  margin: 0;
}
</style>
