<script setup lang="ts">
import { ref } from 'vue';
import { api, errorMessage } from '../api';
import { formatDateTime, toLocalInput } from '../format';
import type { Entry } from '../types';
import ModalDialog from './ModalDialog.vue';

/**
 * Zeit einer internen Notiz anpassen, nur Admins (Entscheid vom 27.10.2026): jede Zeit bis jetzt, nicht in die Zukunft.
 * Die Notiz rückt im Verlauf an die neue Stelle und zeigt «Zeit angepasst» mit der ursprünglichen Zeit.
 */
const props = defineProps<{ entry: Entry }>();
const emit = defineEmits<{ close: []; saved: [] }>();

const initial = toLocalInput(props.entry.createdAt);
const value = ref(initial);
const max = toLocalInput(new Date());
const saving = ref(false);
const error = ref('');

async function save() {
  // Unverändert (das Feld zeigt nur Minuten): nichts anpassen, sonst gälte die Notiz wegen der Sekunden als angepasst
  if (value.value === initial) {
    emit('close');
    return;
  }
  const at = new Date(value.value);
  if (!value.value || Number.isNaN(at.getTime())) {
    error.value = 'Bitte Datum und Uhrzeit angeben';
    return;
  }
  if (at.getTime() > Date.now()) {
    error.value = 'Die Zeit darf nicht in der Zukunft liegen';
    return;
  }
  saving.value = true;
  error.value = '';
  try {
    await api.patch(`/entries/${props.entry.id}/time`, { at: at.toISOString() });
    emit('saved');
  } catch (err) {
    error.value = errorMessage(err);
  } finally {
    saving.value = false;
  }
}
</script>

<template>
  <ModalDialog title="Zeit der Notiz anpassen" @close="emit('close')">
    <div class="field">
      <label for="note-time">Datum und Uhrzeit</label>
      <input id="note-time" v-model="value" class="input" type="datetime-local" :max="max" @keydown.enter="save" />
      <span class="hint faint">
        Die Notiz rückt im Verlauf an die neue Stelle.
        <template v-if="entry.timeChange">Ursprünglich erfasst: {{ formatDateTime(entry.timeChange.originalAt) }}.</template>
      </span>
    </div>
    <div v-if="error" class="error-box">{{ error }}</div>
    <template #footer>
      <button class="btn" type="button" @click="emit('close')">Abbrechen</button>
      <button class="btn btn-primary" type="button" :disabled="saving" @click="save">Speichern</button>
    </template>
  </ModalDialog>
</template>
