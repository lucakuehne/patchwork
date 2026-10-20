<script setup lang="ts">
import { computed, ref } from 'vue';
import { api, errorMessage } from '../api';
import { itemRef, TYPE_LABELS } from '../format';
import { suggestTypeChangeStatus } from '../status-flow';
import { typeChangeChoices } from '../status-move';
import { useSession } from '../stores/session';
import type { ItemType, StatusRef } from '../types';
import ModalDialog from './ModalDialog.vue';

/**
 * Typwechsel von Hand bei einem Vorgang mit Status: fragt nach dem Status im neuen Typ, vorbelegt nach der Rolle des
 * bisherigen Status (Start → Start, Wartet → Wartet, Ablehnen → Ablehnen, sonst «nach Antwort» bzw. Schliessen).
 */
const props = defineProps<{ number: number; type: ItemType; status: StatusRef; targetType: ItemType }>();
const emit = defineEmits<{ close: []; done: [] }>();
const session = useSession();

const current = computed(() => ({ id: props.status.id, type: props.type, closed: props.status.closed }));
const options = computed(() =>
  typeChangeChoices(session.statusesOf(props.targetType), session.statusTargets, current.value, props.targetType),
);
const suggested = suggestTypeChangeStatus(session.statusTargets, current.value, props.targetType);
const statusId = ref(options.value.find((s) => s.id === suggested)?.id ?? options.value[0]?.id ?? '');
const saving = ref(false);
const error = ref('');

async function submit() {
  if (!statusId.value) return;
  saving.value = true;
  error.value = '';
  try {
    await api.post(`/items/${props.number}/type`, { type: props.targetType, statusId: statusId.value });
    emit('done');
  } catch (err) {
    error.value = errorMessage(err);
  } finally {
    saving.value = false;
  }
}
</script>

<template>
  <ModalDialog :title="`${itemRef(number)} wird ${targetType === 'task' ? 'zur Aufgabe' : 'zur Störung'}`" @close="emit('close')">
    <p class="muted intro">
      Bisher {{ TYPE_LABELS[type] }} im Status «{{ status.label }}». Welchen Status erhält der Vorgang als {{ TYPE_LABELS[targetType] }}?
    </p>
    <div class="field">
      <label for="type-change-status">Status</label>
      <select id="type-change-status" v-model="statusId" class="select" autofocus>
        <option v-for="s in options" :key="s.id" :value="s.id">{{ s.label }}{{ s.closed ? ' (abgeschlossen)' : '' }}</option>
      </select>
    </div>
    <div v-if="error" class="error-box">{{ error }}</div>
    <template #footer>
      <button class="btn" type="button" @click="emit('close')">Abbrechen</button>
      <button class="btn btn-primary" type="button" :disabled="saving || !statusId" @click="submit">Typ ändern</button>
    </template>
  </ModalDialog>
</template>

<style scoped>
.intro {
  margin: 0;
}
</style>
