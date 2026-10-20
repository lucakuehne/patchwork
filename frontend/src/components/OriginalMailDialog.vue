<script setup lang="ts">
import { onMounted, ref } from 'vue';
import { api, errorMessage } from '../api';
import { formatDateTime, formatSize } from '../format';
import { renderMailHtml } from '../markdown';
import type { MailView } from '../types';
import ModalDialog from './ModalDialog.vue';

/** Originalmail einer eingehenden Nachricht ansehen; die .eml-Datei lässt sich von hier herunterladen. */
const props = defineProps<{ number: number; messageId: string }>();
const emit = defineEmits<{ close: [] }>();

const mail = ref<MailView | null>(null);
const error = ref('');
const query = `?messageId=${encodeURIComponent(props.messageId)}`;

onMounted(async () => {
  try {
    mail.value = await api.get<MailView>(`/items/${props.number}/original/view${query}`);
  } catch (err) {
    error.value = errorMessage(err);
  }
});
</script>

<template>
  <ModalDialog :title="mail?.headers.subject || 'Originalmail'" wide @close="emit('close')">
    <div v-if="error" class="error-box">{{ error }}</div>
    <div v-else-if="!mail" class="faint">Lädt …</div>
    <template v-else>
      <dl class="headers">
        <dt>Von</dt>
        <dd>{{ mail.headers.from || '–' }}</dd>
        <dt>An</dt>
        <dd>{{ mail.headers.to.join(', ') || '–' }}</dd>
        <template v-if="mail.headers.cc.length">
          <dt>CC</dt>
          <dd>{{ mail.headers.cc.join(', ') }}</dd>
        </template>
        <template v-if="mail.headers.date">
          <dt>Datum</dt>
          <dd>{{ formatDateTime(mail.headers.date) }}</dd>
        </template>
      </dl>
      <div v-if="mail.html" class="prose mail-html mail-body" v-html="renderMailHtml(mail.html)" />
      <pre v-else class="mail-body mail-text">{{ mail.text }}</pre>
      <div v-if="mail.attachments.length" class="stack attachments">
        <h3>Anhänge</h3>
        <a v-for="a in mail.attachments" :key="a.index" :href="`/api/items/${number}/original/attachments/${a.index}${query}`">
          {{ a.filename }} <span class="faint">({{ formatSize(a.size) }})</span>
        </a>
      </div>
    </template>
    <template #footer>
      <a class="btn" :href="`/api/items/${number}/original${query}`">Als .eml herunterladen</a>
      <button class="btn btn-primary" type="button" @click="emit('close')">Schliessen</button>
    </template>
  </ModalDialog>
</template>

<style scoped>
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
  max-height: 60vh;
  overflow: auto;
}
.mail-text {
  margin: 0;
  white-space: pre-wrap;
  font-family: var(--font);
}
.attachments {
  gap: 4px;
}
</style>
