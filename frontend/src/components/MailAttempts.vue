<script setup lang="ts">
import { computed } from 'vue';
import { formatDateTime } from '../format';
import type { MailAttempt, OutgoingStatus, WaitingFor } from '../types';

/**
 * Zustellversuche einer ausgehenden Mail, neuester zuerst, als Zeile in den Angaben (dt/dd) der Ansicht der Mail
 * (Entscheid vom 13.11.2026). Mails von vorher haben nur die Anzahl Versuche.
 */
const props = defineProps<{
  attemptLog: MailAttempt[];
  attempts: number;
  nextAttemptAt: string | null;
  status: OutgoingStatus;
  /** Status «wartet»: die ältere Mail des Postfachs, auf die sie wartet */
  waitingFor?: WaitingFor | null;
}>();

const RESULT: Record<MailAttempt['result'], string> = {
  sent: 'versendet',
  partial: 'teilweise versendet (Testbetrieb)',
  held: 'zurückgehalten (Testbetrieb)',
  failed: 'Fehler',
};

const newestFirst = computed(() => [...props.attemptLog].reverse());
/** Läuft gerade ein Versuch, ist er gezählt, steht aber noch nicht im Protokoll */
const running = computed(() => props.status === 'queued' && props.attempts > props.attemptLog.length);
/** Versuche vor dem 13.11.2026: nur gezählt */
const earlier = computed(() => Math.max(0, props.attempts - props.attemptLog.length - (running.value ? 1 : 0)));
</script>

<template>
  <template v-if="attemptLog.length || attempts > 0 || nextAttemptAt || status === 'waiting'">
    <dt class="attempts-label">Zustellversuche</dt>
    <dd class="attempts-value">
      <ol class="attempts">
        <li v-if="status === 'waiting'" class="next">
          <template v-if="waitingFor">
            Wartet auf die Mail «{{ waitingFor.subject }}» vom {{ formatDateTime(waitingFor.createdAt) }}
          </template>
          <template v-else>Wartet auf ältere Mails desselben Postfachs</template>
          <div class="faint small-note">Mails eines Postfachs gehen in der Reihenfolge hinaus, in der sie entstanden sind.</div>
        </li>
        <li v-if="nextAttemptAt" class="next">Nächster Versuch {{ formatDateTime(nextAttemptAt) }}</li>
        <li v-if="running" class="faint">Ein Versuch läuft gerade</li>
        <li v-for="(a, i) in newestFirst" :key="`${a.at}-${i}`">
          {{ formatDateTime(a.at) }} ·
          <span :class="{ failed: a.result === 'failed' }">{{ RESULT[a.result] }}</span>
          <span v-if="a.permanent" class="failed"> (dauerhaft, keine Wiederholung)</span>
          <template v-if="a.result === 'partial' && a.deliveredTo.length"> an {{ a.deliveredTo.join(', ') }}</template>
          <span class="faint">
            · {{ a.by ? `erneut gesendet von ${a.by}` : 'automatisch' }}<template v-if="a.mailbox"> · über {{ a.mailbox }}</template>
          </span>
          <div v-if="a.error" class="error-detail">{{ a.error }}</div>
        </li>
        <li v-if="earlier" class="faint">
          {{ earlier === 1 ? '1 früherer Versuch' : `${earlier} frühere Versuche` }} ohne Einzelheiten (vor dem 13.11.2026)
        </li>
      </ol>
    </dd>
  </template>
</template>

<style scoped>
/* Die Formatierung der Angaben im Fenster gilt nicht für diese Komponente (eigene Wurzeln), deshalb hier */
.attempts-label {
  color: var(--text-muted);
}
.attempts-value {
  margin: 0;
  overflow-wrap: anywhere;
}
.attempts {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.failed,
.error-detail {
  color: var(--danger);
}
.error-detail {
  font-size: 12px;
}
.next {
  font-weight: 600;
}
.small-note {
  font-size: 12px;
  font-weight: normal;
}
</style>
