<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { api } from '../../api';
import ModalDialog from '../../components/ModalDialog.vue';
import SimulateMailDialog from '../../components/SimulateMailDialog.vue';
import { formatDateTime, formatSize, itemRef } from '../../format';
import { renderMailHtml } from '../../markdown';
import { useSession } from '../../stores/session';
import { useToast } from '../../stores/toast';
import type { IncomingMail, IncomingMailDetail, IncomingResult, Mailbox, SimulationDraft } from '../../types';
import { incomingResultText, INCOMING_RESULTS } from '../../incoming';

/** Protokoll der eingehenden Mails: abgeholte und im Testbetrieb simulierte, mit dem Ergebnis der Verarbeitung. */
const session = useSession();
const toast = useToast();
const route = useRoute();
const router = useRouter();
const mails = ref<IncomingMail[]>([]);
const loading = ref(true);
const open = ref<IncomingMailDetail | null>(null);
const reprocessing = ref(false);
const simulating = ref(false);
const mailboxes = ref<Mailbox[]>([]);

const FILTERS = [
  { key: 'alle', label: 'Alle', results: '' },
  { key: 'neu', label: 'Neue Vorgänge', results: 'created' },
  { key: 'antworten', label: 'Antworten und Notizen', results: 'reply,note,automated' },
  { key: 'ignoriert', label: 'Ignoriert', results: 'ignored' },
  { key: 'fehler', label: 'Fehler', results: 'failed' },
] as const;
const ORIGINS = [
  { key: 'alle', label: 'Echt und simuliert' },
  { key: 'echt', label: 'Nur echte' },
  { key: 'simuliert', label: 'Nur simulierte' },
] as const;

const filter = ref<string>(FILTERS.some((f) => f.key === route.query.ergebnis) ? String(route.query.ergebnis) : 'alle');
const origin = ref<string>(ORIGINS.some((o) => o.key === route.query.herkunft) ? String(route.query.herkunft) : 'alle');

async function load() {
  loading.value = true;
  const params = new URLSearchParams();
  const results = FILTERS.find((f) => f.key === filter.value)?.results ?? '';
  if (results) params.set('result', results);
  if (origin.value === 'echt') params.set('simulated', 'false');
  if (origin.value === 'simuliert') params.set('simulated', 'true');
  try {
    mails.value = await api.get<IncomingMail[]>(`/admin/incoming-mails${params.size ? `?${params}` : ''}`);
  } catch (err) {
    toast.error(err);
  } finally {
    loading.value = false;
  }
}
onMounted(load);
watch([filter, origin], () => {
  const query: Record<string, string> = {};
  if (filter.value !== 'alle') query.ergebnis = filter.value;
  if (origin.value !== 'alle') query.herkunft = origin.value;
  void router.replace({ query });
  void load();
});

async function show(m: IncomingMail) {
  try {
    open.value = await api.get<IncomingMailDetail>(`/admin/incoming-mails/${m.id}`);
  } catch (err) {
    toast.error(err);
  }
}

async function reprocess() {
  if (!open.value) return;
  reprocessing.value = true;
  try {
    const result = await api.post<IncomingMail>(`/admin/incoming-mails/${open.value.id}/reprocess`);
    if (result.result === 'failed') toast.error(`Wieder fehlgeschlagen: ${result.reason ?? ''}`);
    else toast.success(`Verarbeitet: ${incomingResultText(result)}`);
    open.value = null;
    await load();
  } catch (err) {
    toast.error(err);
  } finally {
    reprocessing.value = false;
  }
}

async function startSimulation() {
  try {
    mailboxes.value = (await api.get<Mailbox[]>('/admin/mailboxes')).filter((m) => m.active);
    if (!mailboxes.value.length) {
      toast.error('Es ist kein aktives Postfach eingerichtet.');
      return;
    }
    simulating.value = true;
  } catch (err) {
    toast.error(err);
  }
}

async function simulated(mail: IncomingMail) {
  simulating.value = false;
  draft.value = null;
  toast.success(`Simuliert: ${incomingResultText(mail)}`);
  await load();
}

/** Echte Mail als Vorlage für eine simulierte (vorbelegt, änderbar) */
const draft = ref<SimulationDraft | null>(null);
async function simulateFrom() {
  if (!open.value) return;
  try {
    const [loaded, boxes] = await Promise.all([
      api.get<SimulationDraft>(`/admin/incoming-mails/draft?id=${open.value.id}`),
      api.get<Mailbox[]>('/admin/mailboxes'),
    ]);
    mailboxes.value = boxes.filter((m) => m.active);
    if (!mailboxes.value.length) {
      toast.error('Es ist kein aktives Postfach eingerichtet.');
      return;
    }
    draft.value = loaded;
    open.value = null;
    simulating.value = true;
  } catch (err) {
    toast.error(err);
  }
}

const testMode = computed(() => !!session.info?.testMode);
const kindOf = (result: IncomingResult) => INCOMING_RESULTS[result].kind;
const sender = (m: IncomingMail) => (m.fromName ? `${m.fromName} <${m.fromAddress}>` : m.fromAddress);
</script>

<template>
  <div class="stack">
    <div class="row head">
      <h1>Eingehende Mails</h1>
      <div class="spacer" />
      <button v-if="testMode" class="btn" type="button" @click="startSimulation">Neue Mail simulieren</button>
    </div>
    <p class="muted" style="margin: 0">
      Jede Mail, die Patchwork aus den Postfächern abholt, und im Testbetrieb simulierte Mails, jeweils mit dem Ergebnis der
      Verarbeitung.
    </p>
    <div class="row filters">
      <div class="segmented">
        <button v-for="f in FILTERS" :key="f.key" type="button" :class="{ active: filter === f.key }" @click="filter = f.key">
          {{ f.label }}
        </button>
      </div>
      <div class="segmented">
        <button v-for="o in ORIGINS" :key="o.key" type="button" :class="{ active: origin === o.key }" @click="origin = o.key">
          {{ o.label }}
        </button>
      </div>
    </div>
    <div class="card table-wrap">
      <table class="table">
        <thead>
          <tr>
            <th>Zeit</th>
            <th>Ergebnis</th>
            <th>Von</th>
            <th>Betreff</th>
            <th>Vorgang</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="m in mails" :key="m.id" class="clickable" @click="show(m)">
            <td class="nowrap muted">{{ formatDateTime(m.createdAt) }}</td>
            <td class="nowrap">
              <span class="badge" :class="kindOf(m.result)" :title="m.reason ?? undefined">{{ INCOMING_RESULTS[m.result].label }}</span>
              <span v-if="m.simulated" class="badge simulated" :title="m.simulatedBy ? `Simuliert von ${m.simulatedBy}` : undefined">
                simuliert
              </span>
            </td>
            <td>{{ sender(m) }}</td>
            <td>{{ m.subject }}</td>
            <td class="nowrap">
              <RouterLink v-if="m.item" :to="`/v/${m.item.number}`" :title="m.item.title" @click.stop>
                {{ itemRef(m.item.number) }}
              </RouterLink>
              <span v-else class="faint">–</span>
            </td>
          </tr>
        </tbody>
      </table>
      <div v-if="!loading && !mails.length" class="empty">Keine Mails.</div>
    </div>

    <ModalDialog v-if="open" :title="open.subject || '(ohne Betreff)'" wide @close="open = null">
      <dl class="headers">
        <dt>Ergebnis</dt>
        <dd>
          <span class="badge" :class="kindOf(open.result)">{{ INCOMING_RESULTS[open.result].label }}</span>
          <span v-if="open.simulated" class="badge simulated">simuliert</span>
          <template v-if="open.attempts > 1"> · {{ open.attempts }} Versuche</template>
        </dd>
        <template v-if="open.reason">
          <dt>{{ open.result === 'failed' ? 'Fehler' : 'Grund' }}</dt>
          <dd :class="{ 'error-text': open.result === 'failed' }">{{ open.reason }}</dd>
        </template>
        <dt>Von</dt>
        <dd>{{ sender(open) }}</dd>
        <dt>An</dt>
        <dd>{{ open.to.join(', ') || '–' }}</dd>
        <template v-if="open.cc.length">
          <dt>CC</dt>
          <dd>{{ open.cc.join(', ') }}</dd>
        </template>
        <template v-if="open.mailDate">
          <dt>Datum</dt>
          <dd>{{ formatDateTime(open.mailDate) }}</dd>
        </template>
        <dt>{{ open.simulated ? 'Simuliert' : 'Abgeholt' }}</dt>
        <dd>
          {{ formatDateTime(open.createdAt) }}
          <template v-if="open.simulatedBy"> von {{ open.simulatedBy }}</template>
          <template v-if="open.mailbox"> · Postfach {{ open.mailbox.name }}</template>
        </dd>
        <template v-if="open.item">
          <dt>Vorgang</dt>
          <dd>
            <RouterLink :to="`/v/${open.item.number}`">{{ itemRef(open.item.number) }} {{ open.item.title }}</RouterLink>
          </dd>
        </template>
      </dl>
      <div v-if="open.html" class="prose mail-html mail-body" v-html="renderMailHtml(open.html)" />
      <pre v-else class="mail-body mail-text">{{ open.text }}</pre>
      <div v-if="open.attachments.length" class="stack attachments">
        <h3>Anhänge</h3>
        <a v-for="a in open.attachments" :key="a.index" :href="`/api/admin/incoming-mails/${open.id}/attachments/${a.index}`">
          {{ a.filename }} <span class="faint">({{ formatSize(a.size) }})</span>
        </a>
      </div>
      <template #footer>
        <a class="btn" :href="`/api/admin/incoming-mails/${open.id}/eml`">Als .eml herunterladen</a>
        <button v-if="testMode" class="btn" type="button" @click="simulateFrom">Als simulierte Mail …</button>
        <button v-if="open.result === 'failed'" class="btn" type="button" :disabled="reprocessing" @click="reprocess">
          Erneut verarbeiten
        </button>
        <button class="btn btn-primary" type="button" @click="open = null">Schliessen</button>
      </template>
    </ModalDialog>

    <SimulateMailDialog
      v-if="simulating"
      :mailboxes="mailboxes"
      :original="draft ?? undefined"
      @close="
        simulating = false;
        draft = null;
      "
      @done="simulated"
    />
  </div>
</template>

<style scoped>
.head {
  align-items: center;
}
.filters {
  flex-wrap: wrap;
  gap: 8px;
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
}
.mail-text {
  margin: 0;
  white-space: pre-wrap;
  font-family: var(--font);
}
.attachments {
  gap: 4px;
}
.badge + .badge {
  margin-left: 4px;
}
.badge.created {
  background: var(--accent-soft);
  color: var(--accent);
}
.badge.reply {
  background: var(--success-soft);
  color: var(--success);
}
.badge.note {
  background: var(--note-soft);
  color: var(--note-text);
}
.badge.muted {
  background: var(--surface-2);
  color: var(--text-muted);
}
.badge.failed {
  background: var(--danger-soft);
  color: var(--danger);
}
</style>
