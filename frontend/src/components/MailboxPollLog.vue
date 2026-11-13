<script setup lang="ts">
import { ref, watch } from 'vue';
import { api } from '../api';
import { pollDurationText, pollResultText, pollTimeText } from '../mailbox-polls';
import { useToast } from '../stores/toast';
import type { MailboxPoll, MailboxPollPage } from '../types';

/**
 * Abrufprotokoll eines Postfachs, aufklappbar in der Karte unter Verwaltung → Postfächer (Entscheid vom 13.11.2026):
 * neueste zuerst, automatische Abrufe ohne neue Mails (ohne Fehler oder mit demselben) zusammengefasst, Filter «Nur
 * Fehler», 14 Tage aufbewahrt.
 */
const props = defineProps<{
  mailboxId: string;
  /** Ändert sich nach «Jetzt abrufen»: das offene Protokoll lädt dann neu */
  lastPollAt: string | null;
}>();
const toast = useToast();

const FIRST_PAGE = 10;
const NEXT_PAGE = 20;
const open = ref(false);
const errorsOnly = ref(false);
const entries = ref<MailboxPoll[]>([]);
const more = ref(false);
const loaded = ref(false);
const loading = ref(false);

function fetchPage(before?: string) {
  const params = new URLSearchParams({ limit: String(before ? NEXT_PAGE : FIRST_PAGE), errors: errorsOnly.value ? '1' : '0' });
  if (before) params.set('before', before);
  return api.get<MailboxPollPage>(`/admin/mailboxes/${props.mailboxId}/polls?${params}`);
}

async function reload() {
  loading.value = true;
  try {
    const page = await fetchPage();
    entries.value = page.entries;
    more.value = page.more;
    loaded.value = true;
  } catch (err) {
    toast.error(err);
  } finally {
    loading.value = false;
  }
}

async function loadMore() {
  const last = entries.value.at(-1);
  if (!last) return;
  loading.value = true;
  try {
    const page = await fetchPage(last.startedAt);
    entries.value = [...entries.value, ...page.entries];
    more.value = page.more;
  } catch (err) {
    toast.error(err);
  } finally {
    loading.value = false;
  }
}

function onToggle(event: Event) {
  open.value = (event.target as HTMLDetailsElement).open;
  if (open.value) void reload();
}
watch(errorsOnly, () => void reload());
watch(
  () => props.lastPollAt,
  () => {
    if (open.value) void reload();
  },
);
</script>

<template>
  <details class="poll-log" @toggle="onToggle">
    <summary>Abrufprotokoll</summary>
    <div class="poll-body">
      <label class="checkbox small">
        <input v-model="errorsOnly" type="checkbox" />
        Nur Fehler
      </label>
      <p v-if="loaded && !entries.length" class="faint small empty">
        {{ errorsOnly ? 'Keine Fehler in den letzten 14 Tagen.' : 'Keine Abrufe in den letzten 14 Tagen.' }}
      </p>
      <ol v-else class="polls small">
        <li v-for="p in entries" :key="p.id">
          {{ pollTimeText(p) }} ·
          <span :class="{ failed: p.error }">{{ pollResultText(p) }}</span>
          <span v-if="p.polls === 1" class="faint">
            · {{ pollDurationText(p.durationMs) }} · {{ p.triggeredBy ? `Jetzt abrufen von ${p.triggeredBy}` : 'automatisch' }}
          </span>
          <div v-if="p.error" class="error-detail">{{ p.error }}</div>
        </li>
      </ol>
      <div v-if="more">
        <button class="btn btn-sm btn-ghost" type="button" :disabled="loading" @click="loadMore">Weitere anzeigen</button>
      </div>
    </div>
  </details>
</template>

<style scoped>
.poll-log summary {
  cursor: pointer;
  font-size: 13px;
  color: var(--text-muted);
  width: fit-content;
}
.poll-body {
  display: flex;
  flex-direction: column;
  gap: 8px;
  margin-top: 8px;
}
.polls {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 4px;
  overflow-wrap: anywhere;
}
.failed,
.error-detail {
  color: var(--danger);
}
.error-detail {
  font-size: 12px;
}
.empty {
  margin: 0;
}
</style>
