<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { api } from '../api';
import { retryPlanText } from '../mail-retry';
import { useToast } from '../stores/toast';
import type { MailRetrySettings } from '../types';

/**
 * Wiederholungen beim Versand (Entscheid vom 13.11.2026): Anzahl, erster Abstand, verdoppeln bis zu einer Obergrenze.
 * Darunter der Ablauf als Satz. Änderungen gelten sofort, auch für Mails, die auf ihren nächsten Versuch warten.
 */
const toast = useToast();
const form = ref<MailRetrySettings | null>(null);
const saving = ref(false);

onMounted(async () => {
  try {
    form.value = await api.get<MailRetrySettings>('/admin/outgoing-mails/retry-settings');
  } catch (err) {
    toast.error(err);
  }
});

const plan = computed(() => {
  const f = form.value;
  if (!f) return '';
  const valid = [f.retries, f.firstDelayMinutes, f.maxDelayMinutes].every((v) => Number.isInteger(v) && v >= 0);
  return valid ? retryPlanText(f) : '';
});

async function save() {
  if (!form.value) return;
  saving.value = true;
  try {
    form.value = await api.put<MailRetrySettings>('/admin/outgoing-mails/retry-settings', {
      retries: Number(form.value.retries),
      firstDelayMinutes: Number(form.value.firstDelayMinutes),
      doubling: form.value.doubling,
      maxDelayMinutes: Number(form.value.maxDelayMinutes),
    });
    toast.success('Gespeichert');
  } catch (err) {
    toast.error(err);
  } finally {
    saving.value = false;
  }
}
</script>

<template>
  <div class="card card-body stack retry-settings">
    <h2>Wiederholungen</h2>
    <span class="hint faint">
      Schlägt der Versand fehl, steht die Mail auf «Fehler», und Patchwork versucht es nach diesen Abständen erneut. Eine
      Änderung gilt sofort, auch für Mails, die auf ihren nächsten Versuch warten. «Als erledigt markieren» beendet die
      Versuche.
    </span>
    <template v-if="form">
      <div class="fields">
        <div class="field">
          <label for="retry-count">Anzahl Wiederholungen</label>
          <input id="retry-count" v-model.number="form.retries" class="input" type="number" min="0" max="20" step="1" />
        </div>
        <div class="field">
          <label for="retry-first">Erster Abstand (Minuten)</label>
          <input id="retry-first" v-model.number="form.firstDelayMinutes" class="input" type="number" min="1" max="1440" step="1" />
        </div>
      </div>
      <div class="doubling">
        <label class="checkbox">
          <input v-model="form.doubling" type="checkbox" />
          Abstand jedes Mal verdoppeln, höchstens bis
        </label>
        <input
          v-model.number="form.maxDelayMinutes"
          class="input max"
          type="number"
          min="1"
          max="1440"
          step="1"
          aria-label="Höchster Abstand in Minuten"
          :disabled="!form.doubling"
        />
        <span>Minuten</span>
      </div>
      <p v-if="plan" class="plan">{{ plan }}</p>
      <div><button class="btn btn-primary" type="button" :disabled="saving" @click="save">Speichern</button></div>
    </template>
  </div>
</template>

<style scoped>
.fields {
  display: flex;
  flex-wrap: wrap;
  gap: 12px 24px;
}
.fields .input {
  max-width: 140px;
}
.doubling {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
}
.max {
  width: 90px;
}
.plan {
  margin: 0;
  font-size: 13px;
  color: var(--text-muted);
}
</style>
