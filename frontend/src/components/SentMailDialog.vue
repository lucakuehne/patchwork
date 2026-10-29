<script setup lang="ts">
import { onMounted, ref, watch } from 'vue';
import { api, errorMessage } from '../api';
import { formatDateTime } from '../format';
import { itemRef, type ItemKey } from '../item-ref';
import { renderOwnMailHtml } from '../markdown';
import { OUTGOING_STATUS } from '../outgoing';
import type { OutgoingStatus, SentMail } from '../types';
import MailAttachmentList from './MailAttachmentList.vue';
import ModalDialog from './ModalDialog.vue';

/**
 * Eine von Patchwork zu einem Vorgang versendete Mail (automatische Mail oder öffentliche Antwort) ansehen: Kopf mit
 * Status und Empfängern, darunter die Mail, so wie sie ohne Testbetrieb versendet wird.
 */
const props = defineProps<{
  itemKey: ItemKey;
  mailId: string;
  /** Status laut Verlauf: Ändert er sich (z.B. von «wird versendet» auf versendet), lädt die Ansicht neu */
  status?: OutgoingStatus;
}>();
const emit = defineEmits<{ close: [] }>();

const mail = ref<SentMail | null>(null);
const error = ref('');
const base = `/api/items/${itemRef(props.itemKey)}/mails/${props.mailId}`;

async function load() {
  try {
    mail.value = await api.get<SentMail>(`/items/${itemRef(props.itemKey)}/mails/${props.mailId}`);
    error.value = '';
  } catch (err) {
    error.value = errorMessage(err);
  }
}
onMounted(load);
watch(
  () => props.status,
  (now, before) => {
    if (now !== before) void load();
  },
);
</script>

<template>
  <ModalDialog :title="mail ? `Mail «${mail.label}»` : 'Mail'" wide @close="emit('close')">
    <div v-if="error" class="error-box">{{ error }}</div>
    <div v-else-if="!mail" class="faint">Lädt …</div>
    <template v-else>
      <dl class="headers">
        <dt>Status</dt>
        <dd>
          <span class="badge" :class="OUTGOING_STATUS[mail.status].kind">{{ OUTGOING_STATUS[mail.status].label }}</span>
          <template v-if="mail.sentAt"> · {{ formatDateTime(mail.sentAt) }}</template>
        </dd>
        <template v-if="mail.error">
          <dt>Fehler</dt>
          <dd class="error-text">{{ mail.error }}</dd>
        </template>
        <template v-if="mail.status === 'partial' || mail.status === 'held'">
          <dt>Erhalten</dt>
          <dd>{{ mail.deliveredTo.length ? mail.deliveredTo.join(', ') : 'niemand (Testbetrieb)' }}</dd>
        </template>
        <dt>Von</dt>
        <dd>{{ mail.fromAddress }}</dd>
        <dt>An</dt>
        <dd>{{ mail.to.join(', ') || '–' }}</dd>
        <template v-if="mail.cc.length">
          <dt>CC</dt>
          <dd>{{ mail.cc.join(', ') }}</dd>
        </template>
        <dt>Betreff</dt>
        <dd>{{ mail.subject }}</dd>
        <dt>Zeit</dt>
        <dd>{{ formatDateTime(mail.createdAt) }}</dd>
      </dl>
      <div v-if="mail.html" class="prose mail-html mail-body own-mail" v-html="renderOwnMailHtml(mail.html)" />
      <pre v-else class="mail-body mail-text own-mail">{{ mail.text }}</pre>
      <MailAttachmentList :attachments="mail.attachments" :path="(index) => `${base}/attachments/${index}`" />
    </template>
    <template #footer>
      <a v-if="mail" class="btn" :href="`${base}/eml`">Als .eml herunterladen</a>
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
.error-text {
  color: var(--danger);
}
.mail-body {
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  padding: 12px;
  max-height: 55vh;
  overflow: auto;
  /* Formatierungen der Mail (Inline-Styles) bleiben in diesem Rahmen */
  contain: paint;
}
.mail-text {
  margin: 0;
  white-space: pre-wrap;
  font-family: var(--font);
}
.badge.sent {
  background: var(--success-soft);
  color: var(--success);
}
.badge.held {
  background: var(--warning-soft);
  color: var(--warning);
}
.badge.failed {
  background: var(--danger-soft);
  color: var(--danger);
}
.badge.queued {
  background: var(--surface-2);
  color: var(--text-muted);
}
</style>
