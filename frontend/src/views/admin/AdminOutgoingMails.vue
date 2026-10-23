<script setup lang="ts">
import { onMounted, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { api } from '../../api';
import MailAttachmentList from '../../components/MailAttachmentList.vue';
import ModalDialog from '../../components/ModalDialog.vue';
import SimulateMailDialog from '../../components/SimulateMailDialog.vue';
import TestModeSettings from '../../components/TestModeSettings.vue';
import { formatDateTime, itemRef } from '../../format';
import { incomingResultText } from '../../incoming';
import { renderOwnMailHtml } from '../../markdown';
import { OUTGOING_STATUS } from '../../outgoing';
import { useSession } from '../../stores/session';
import { useToast } from '../../stores/toast';
import type { IncomingMail, OutgoingMail, OutgoingMailDetail } from '../../types';

/** Protokoll aller ausgehenden Mails, mit Filter nach Status, und darüber der Testbetrieb. */
const session = useSession();
const toast = useToast();
const route = useRoute();
const router = useRouter();
const mails = ref<OutgoingMail[]>([]);
const loading = ref(true);
const open = ref<OutgoingMailDetail | null>(null);
const resending = ref(false);
/** Mail, auf die gerade eine Antwort simuliert wird */
const replyTo = ref<OutgoingMailDetail | null>(null);

function startReply() {
  replyTo.value = open.value;
  open.value = null;
}

function simulated(mail: IncomingMail) {
  replyTo.value = null;
  if (mail.result === 'failed') toast.error(`Simulierte Antwort: ${incomingResultText(mail)}`);
  else toast.success(`Simulierte Antwort: ${incomingResultText(mail)}`);
}

const FILTERS = [
  { key: 'alle', label: 'Alle', statuses: '' },
  { key: 'nicht-versendet', label: 'Nicht oder teilweise versendet', statuses: 'held,partial' },
  { key: 'fehler', label: 'Fehler und unterwegs', statuses: 'failed,queued' },
  { key: 'versendet', label: 'Versendet', statuses: 'sent' },
] as const;

const filter = ref<string>(FILTERS.some((f) => f.key === route.query.status) ? String(route.query.status) : 'alle');

const STATUS = OUTGOING_STATUS;

async function load() {
  loading.value = true;
  const statuses = FILTERS.find((f) => f.key === filter.value)?.statuses ?? '';
  try {
    mails.value = await api.get<OutgoingMail[]>(`/admin/outgoing-mails${statuses ? `?status=${statuses}` : ''}`);
  } catch (err) {
    toast.error(err);
  } finally {
    loading.value = false;
  }
}
onMounted(load);
watch(filter, () => {
  void router.replace({ query: filter.value === 'alle' ? {} : { status: filter.value } });
  void load();
});

async function show(m: OutgoingMail) {
  try {
    open.value = await api.get<OutgoingMailDetail>(`/admin/outgoing-mails/${m.id}`);
  } catch (err) {
    toast.error(err);
  }
}

async function resend() {
  if (!open.value) return;
  resending.value = true;
  try {
    await api.post(`/admin/outgoing-mails/${open.value.id}/resend`);
    toast.success('Mail ist wieder in der Versand-Queue');
    open.value = null;
    await load();
  } catch (err) {
    toast.error(err);
  } finally {
    resending.value = false;
  }
}

const kind = (m: OutgoingMail) => (m.reply ? 'Antwort' : 'Automatisch');
const recipients = (m: OutgoingMail) => [...m.to, ...m.cc.map((c) => `CC ${c}`)].join(', ');
</script>

<template>
  <div class="stack">
    <h1>Ausgehende Mails</h1>
    <p class="muted" style="margin: 0">
      Jede Mail, die Patchwork verschickt oder im Testbetrieb zurückhält, steht unten vollständig, so wie sie ohne Testbetrieb
      versendet wird.
    </p>
    <TestModeSettings @saved="load" />
    <div class="segmented filters">
      <button v-for="f in FILTERS" :key="f.key" type="button" :class="{ active: filter === f.key }" @click="filter = f.key">
        {{ f.label }}
      </button>
    </div>
    <div class="card table-wrap">
      <table class="table">
        <thead>
          <tr>
            <th>Zeit</th>
            <th>Status</th>
            <th>An</th>
            <th>Betreff</th>
            <th>Vorgang</th>
            <th>Art</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="m in mails" :key="m.id" class="clickable" @click="show(m)">
            <td class="nowrap muted">{{ formatDateTime(m.createdAt) }}</td>
            <td class="nowrap">
              <span class="badge" :class="STATUS[m.status].kind" :title="m.error ?? undefined">{{ STATUS[m.status].label }}</span>
            </td>
            <td>{{ recipients(m) }}</td>
            <td>{{ m.subject }}</td>
            <td class="nowrap">
              <RouterLink :to="`/v/${m.item.number}`" :title="m.item.title" @click.stop>{{ itemRef(m.item.number) }}</RouterLink>
            </td>
            <td><span class="badge">{{ kind(m) }}</span></td>
          </tr>
        </tbody>
      </table>
      <div v-if="!loading && !mails.length" class="empty">Keine Mails.</div>
    </div>

    <ModalDialog v-if="open" :title="open.subject" wide @close="open = null">
      <dl class="headers">
        <dt>Status</dt>
        <dd>
          <span class="badge" :class="STATUS[open.status].kind">{{ STATUS[open.status].label }}</span>
          <template v-if="open.sentAt"> · {{ formatDateTime(open.sentAt) }}</template>
          <template v-if="open.attempts > 1"> · {{ open.attempts }} Versuche</template>
        </dd>
        <template v-if="open.error">
          <dt>Fehler</dt>
          <dd class="error-text">{{ open.error }}</dd>
        </template>
        <template v-if="open.status === 'partial' || open.status === 'held'">
          <dt>Erhalten</dt>
          <dd>{{ open.deliveredTo.length ? `${open.deliveredTo.join(', ')} (nur diese im Kopf)` : 'niemand' }}</dd>
        </template>
        <dt>Von</dt>
        <dd>{{ open.fromAddress }}</dd>
        <dt>An</dt>
        <dd>{{ open.to.join(', ') || '–' }}</dd>
        <template v-if="open.cc.length">
          <dt>CC</dt>
          <dd>{{ open.cc.join(', ') }}</dd>
        </template>
        <dt>Zeit</dt>
        <dd>{{ formatDateTime(open.createdAt) }}</dd>
        <dt>Vorgang</dt>
        <dd>
          <RouterLink :to="`/v/${open.item.number}`">{{ itemRef(open.item.number) }} {{ open.item.title }}</RouterLink>
        </dd>
      </dl>
      <div v-if="open.html" class="prose mail-html mail-body own-mail" v-html="renderOwnMailHtml(open.html)" />
      <pre v-else class="mail-body mail-text own-mail">{{ open.text }}</pre>
      <MailAttachmentList :attachments="open.attachments" :path="(index) => `/api/admin/outgoing-mails/${open!.id}/attachments/${index}`" />
      <template #footer>
        <a class="btn" :href="`/api/admin/outgoing-mails/${open.id}/eml`">Als .eml herunterladen</a>
        <button v-if="session.info?.testMode" class="btn" type="button" @click="startReply">Antwort simulieren</button>
        <button v-if="open.status === 'failed'" class="btn" type="button" :disabled="resending" @click="resend">
          Erneut senden
        </button>
        <button class="btn btn-primary" type="button" @click="open = null">Schliessen</button>
      </template>
    </ModalDialog>

    <SimulateMailDialog v-if="replyTo" :reply="replyTo" @close="replyTo = null" @done="simulated" />
  </div>
</template>

<style scoped>
.filters {
  align-self: flex-start;
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
.error-text {
  color: var(--danger);
}
.mail-body {
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  padding: 12px;
  max-height: 50vh;
  overflow: auto;
  /* Formatierungen der Mail (Inline-Styles) bleiben in diesem Rahmen, auch z.B. position: fixed */
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
