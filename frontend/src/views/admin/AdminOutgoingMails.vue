<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { api, ApiError } from '../../api';
import ItemLink from '../../components/ItemLink.vue';
import MailAttachmentList from '../../components/MailAttachmentList.vue';
import MailAttempts from '../../components/MailAttempts.vue';
import MailKindHelp from '../../components/MailKindHelp.vue';
import MailRetrySettings from '../../components/MailRetrySettings.vue';
import ModalDialog from '../../components/ModalDialog.vue';
import SimulateMailDialog from '../../components/SimulateMailDialog.vue';
import TestModeSettings from '../../components/TestModeSettings.vue';
import { formatDateTime, itemRef } from '../../format';
import { incomingResultText } from '../../incoming';
import { renderOwnMailHtml } from '../../markdown';
import { OUTGOING_STATUS } from '../../outgoing';
import { useSession } from '../../stores/session';
import { useToast } from '../../stores/toast';
import type { IncomingMail, MailKind, OutgoingMail, OutgoingMailDetail } from '../../types';

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
  { key: 'all', label: 'Alle', statuses: '' },
  { key: 'withheld', label: 'Nicht oder teilweise versendet', statuses: 'held,partial' },
  { key: 'failed', label: 'Fehler und unterwegs', statuses: 'failed,queued,waiting' },
  { key: 'sent', label: 'Versendet', statuses: 'sent' },
] as const;

const filter = ref<string>(FILTERS.some((f) => f.key === route.query.status) ? String(route.query.status) : 'all');

const STATUS = OUTGOING_STATUS;

async function load() {
  loading.value = true;
  const statuses = FILTERS.find((f) => f.key === filter.value)?.statuses ?? '';
  try {
    mails.value = await api.get<OutgoingMail[]>(`/admin/outgoing-mails${statuses ? `?status=${statuses}` : ''}`);
    // Auswahl nur mit Mails, die noch in der Liste stehen
    selected.value = new Set([...selected.value].filter((id) => mails.value.some((m) => m.id === id)));
  } catch (err) {
    toast.error(err);
  } finally {
    loading.value = false;
  }
}
onMounted(load);
watch(filter, () => {
  selected.value = new Set();
  void router.replace({ query: filter.value === 'all' ? {} : { status: filter.value } });
  void load();
});

/*
 * Massenaktionen (Entscheid vom 13.11.2026): Häkchen je Zeile, im Kopf für alle Mails der Liste (alle Treffer des
 * Filters, höchstens 500). «Erneut senden» und «Als erledigt markieren» nur bei fehlgeschlagenen, die übrigen werden
 * übersprungen; «Als .eml herunterladen» eine Mail als .eml, mehrere als ZIP.
 */
const selected = ref(new Set<string>());
const bulkBusy = ref(false);
const allSelected = computed(() => mails.value.length > 0 && mails.value.every((m) => selected.value.has(m.id)));
const someSelected = computed(() => selected.value.size > 0 && !allSelected.value);

function toggle(id: string) {
  const next = new Set(selected.value);
  if (!next.delete(id)) next.add(id);
  selected.value = next;
}
function toggleAll() {
  selected.value = allSelected.value ? new Set() : new Set(mails.value.map((m) => m.id));
}

const skippedText = (skipped: number, reason: string) => (skipped ? `, ${skipped} übersprungen (${reason})` : '');

async function bulkResend() {
  bulkBusy.value = true;
  try {
    const r = await api.post<{ done: number; skipped: number }>('/admin/outgoing-mails/bulk/resend', { ids: [...selected.value] });
    toast.success(`${r.done === 1 ? '1 Mail' : `${r.done} Mails`} wieder in der Versand-Queue${skippedText(r.skipped, 'nicht fehlgeschlagen')}`);
    selected.value = new Set();
    await load();
  } catch (err) {
    toast.error(err);
  } finally {
    bulkBusy.value = false;
  }
}

async function bulkDismiss() {
  bulkBusy.value = true;
  try {
    const r = await api.post<{ done: number; skipped: number }>('/admin/outgoing-mails/bulk/dismiss', { ids: [...selected.value] });
    toast.success(
      `${r.done === 1 ? '1 Mail' : `${r.done} Mails`} als erledigt markiert${skippedText(r.skipped, 'nicht fehlgeschlagen oder schon erledigt')}`,
    );
    selected.value = new Set();
    await load();
  } catch (err) {
    toast.error(err);
  } finally {
    bulkBusy.value = false;
  }
}

/** Eine Mail als .eml, mehrere als ZIP («Ausgehende Mails 2026-11-13.zip») */
async function bulkDownload() {
  const ids = [...selected.value];
  if (ids.length === 1) {
    window.location.href = `/api/admin/outgoing-mails/${ids[0]}/eml`;
    return;
  }
  bulkBusy.value = true;
  try {
    const res = await fetch('/api/admin/outgoing-mails/bulk/eml', {
      method: 'POST',
      headers: { 'X-Patchwork': '1', 'Content-Type': 'application/json' },
      body: JSON.stringify({ ids }),
      credentials: 'same-origin',
    });
    if (!res.ok) throw new ApiError(res.status, `Herunterladen fehlgeschlagen (Fehler ${res.status})`);
    const name = /filename\*=UTF-8''([^;]+)/i.exec(res.headers.get('Content-Disposition') ?? '')?.[1];
    const url = URL.createObjectURL(await res.blob());
    const link = document.createElement('a');
    link.href = url;
    link.download = name ? decodeURIComponent(name) : 'Ausgehende Mails.zip';
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 10_000);
  } catch (err) {
    toast.error(err);
  } finally {
    bulkBusy.value = false;
  }
}

async function show(m: OutgoingMail) {
  try {
    open.value = await api.get<OutgoingMailDetail>(`/admin/outgoing-mails/${m.id}`);
  } catch (err) {
    toast.error(err);
  }
}

/** Fehlgeschlagene Mail als erledigt markieren: Der Hinweis für die Admins oben verschwindet, die Mail bleibt im Protokoll */
async function dismiss() {
  if (!open.value) return;
  try {
    await api.post(`/admin/outgoing-mails/${open.value.id}/dismiss`);
    toast.success('Als erledigt markiert');
    open.value = null;
    await load();
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

/** Arten von Mails mit Erklärung (Tooltips in der Liste und im Testbetrieb) */
const kinds = ref<MailKind[]>([]);
onMounted(async () => {
  try {
    kinds.value = await api.get<MailKind[]>('/admin/mail-templates/kinds');
  } catch (err) {
    toast.error(err);
  }
});
const kindOf = (m: OutgoingMail) => kinds.value.find((k) => k.key === m.template);
/** Name der Benachrichtigung; ältere Mails ohne Vorlage wie bisher */
const kind = (m: OutgoingMail) => kindOf(m)?.label ?? (m.template === 'welcome' ? 'Willkommen' : m.reply ? 'Antwort' : 'Automatisch');
const recipients = (m: OutgoingMail) => [...m.to, ...m.cc.map((c) => `CC ${c}`)].join(', ');
</script>

<template>
  <div class="stack">
    <h1>Ausgehende Mails</h1>
    <p class="muted" style="margin: 0">
      Jede Mail, die Patchwork verschickt oder im Testbetrieb zurückhält, steht unten vollständig, so wie sie ohne Testbetrieb
      versendet wird.
    </p>
    <TestModeSettings :kinds="kinds" @saved="load" />
    <MailRetrySettings />
    <div class="segmented filters">
      <button v-for="f in FILTERS" :key="f.key" type="button" :class="{ active: filter === f.key }" @click="filter = f.key">
        {{ f.label }}
      </button>
    </div>
    <div v-if="selected.size" class="bulk-bar card">
      <span class="bulk-count">{{ selected.size === 1 ? '1 Mail ausgewählt' : `${selected.size} Mails ausgewählt` }}</span>
      <button class="btn btn-sm" type="button" :disabled="bulkBusy" @click="bulkResend">Erneut senden</button>
      <button class="btn btn-sm" type="button" :disabled="bulkBusy" @click="bulkDownload">Als .eml herunterladen</button>
      <button class="btn btn-sm" type="button" :disabled="bulkBusy" @click="bulkDismiss">Als erledigt markieren</button>
      <button class="btn btn-sm btn-ghost" type="button" @click="selected = new Set()">Auswahl aufheben</button>
    </div>
    <div class="card table-wrap">
      <table class="table">
        <thead>
          <tr>
            <th class="pick">
              <input
                type="checkbox"
                :checked="allSelected"
                :indeterminate="someSelected"
                :disabled="!mails.length"
                aria-label="Alle Mails der Liste auswählen"
                @change="toggleAll"
              />
            </th>
            <th>Zeit</th>
            <th>Status</th>
            <th>An</th>
            <th>Betreff</th>
            <th>Vorgang</th>
            <th>Art</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="m in mails" :key="m.id" class="clickable" :class="{ picked: selected.has(m.id) }" @click="show(m)">
            <td class="pick" @click.stop="toggle(m.id)">
              <input type="checkbox" :checked="selected.has(m.id)" :aria-label="`${m.subject} auswählen`" @click.stop @change="toggle(m.id)" />
            </td>
            <td class="nowrap muted">{{ formatDateTime(m.createdAt) }}</td>
            <td class="nowrap">
              <span class="badge" :class="STATUS[m.status].kind" :title="m.error ?? undefined">{{ STATUS[m.status].label }}</span>
              <span v-if="m.status === 'failed' && m.dismissedAt" class="badge" title="Als erledigt markiert, kein Hinweis mehr">
                erledigt
              </span>
            </td>
            <td>{{ recipients(m) }}</td>
            <td>{{ m.subject }}</td>
            <td class="nowrap">
              <ItemLink v-if="m.item" :item-key="m.item" :type="m.item.type" :title="m.item.title" @click.stop>{{ itemRef(m.item) }}</ItemLink>
              <span v-else class="faint">–</span>
            </td>
            <td class="nowrap">
              <span class="kind">
                <span class="badge">{{ kind(m) }}</span>
                <MailKindHelp v-if="kindOf(m)" :kind="kindOf(m)!" />
              </span>
            </td>
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
        </dd>
        <template v-if="open.error">
          <dt>Fehler</dt>
          <dd class="error-text">{{ open.error }}</dd>
        </template>
        <MailAttempts
          :attempt-log="open.attemptLog"
          :attempts="open.attempts"
          :next-attempt-at="open.nextAttemptAt"
          :status="open.status"
          :waiting-for="open.waitingFor"
        />
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
        <template v-if="open.item">
          <dt>Vorgang</dt>
          <dd>
            <ItemLink :item-key="open.item" :type="open.item.type">{{ itemRef(open.item) }} {{ open.item.title }}</ItemLink>
          </dd>
        </template>
      </dl>
      <div v-if="open.html" class="prose mail-html mail-body own-mail" v-html="renderOwnMailHtml(open.html)" />
      <pre v-else class="mail-body mail-text own-mail">{{ open.text }}</pre>
      <MailAttachmentList :attachments="open.attachments" :path="(index) => `/api/admin/outgoing-mails/${open!.id}/attachments/${index}`" />
      <template #footer>
        <a class="btn" :href="`/api/admin/outgoing-mails/${open.id}/eml`">Als .eml herunterladen</a>
        <!-- Antworten gibt es nur auf Mails zu einem Vorgang -->
        <button v-if="session.info?.testMode && open.item" class="btn" type="button" @click="startReply">Antwort simulieren</button>
        <button v-if="open.status === 'failed' && !open.dismissedAt" class="btn" type="button" @click="dismiss">
          Als erledigt markieren
        </button>
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
/* Massenaktionen: Leiste über der Liste, solange etwas ausgewählt ist */
.bulk-bar {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
  padding: 8px 12px;
  position: sticky;
  top: var(--sticky-top, 0);
  z-index: 5;
}
.bulk-count {
  font-weight: 600;
  margin-right: 8px;
}
.pick {
  width: 32px;
  cursor: default;
}
tr.picked {
  background: var(--accent-soft);
}
.kind {
  display: inline-flex;
  align-items: center;
  gap: 6px;
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
