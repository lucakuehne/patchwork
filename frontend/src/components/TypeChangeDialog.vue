<script setup lang="ts">
import { computed, ref } from 'vue';
import { api, errorMessage } from '../api';
import { itemRef, TYPE_LABELS } from '../format';
import type { ItemKey } from '../item-ref';
import { suggestTypeChangeStatus } from '../status-flow';
import { typeChangeChoices } from '../status-move';
import { useSession } from '../stores/session';
import type { ItemType, StatusRef } from '../types';
import ModalDialog from './ModalDialog.vue';

/**
 * Typwechsel von Hand: fragt nach dem Status im neuen Typ. Zur Aufgabe (auch aus dem Eingang) ohne Vorauswahl und ohne
 * Ablehnen-Status (seit 23.10.2026). Zur Störung vorbelegt nach der Rolle des bisherigen Status (Start → Start,
 * Wartet → Wartet, Ablehnen → Ablehnen, sonst «nach Antwort» bzw. Schliessen).
 */
const props = defineProps<{ itemKey: ItemKey; type: ItemType | null; status: StatusRef | null; targetType: ItemType }>();
const emit = defineEmits<{ close: []; done: [] }>();
const session = useSession();

const current = computed(() =>
  props.type && props.status ? { id: props.status.id, type: props.type, closed: props.status.closed } : null,
);
const options = computed(() =>
  typeChangeChoices(session.statusesOf(props.targetType), session.statusTargets, current.value, props.targetType),
);
const suggested = props.targetType === 'task' ? '' : suggestTypeChangeStatus(session.statusTargets, current.value, props.targetType);
const statusId = ref(options.value.find((s) => s.id === suggested)?.id ?? '');
const saving = ref(false);
const error = ref('');

async function submit() {
  if (!statusId.value) return;
  saving.value = true;
  error.value = '';
  try {
    await api.post(`/items/${itemRef(props.itemKey)}/type`, { type: props.targetType, statusId: statusId.value });
    emit('done');
  } catch (err) {
    error.value = errorMessage(err);
  } finally {
    saving.value = false;
  }
}
</script>

<template>
  <ModalDialog :title="`${itemRef(itemKey)} wird ${targetType === 'task' ? 'zur Aufgabe' : 'zur Störung'}`" @close="emit('close')">
    <p class="muted intro">
      <template v-if="type && status">Bisher {{ TYPE_LABELS[type] }} im Status «{{ status.label }}». </template>
      Welchen Status erhält der Vorgang als {{ TYPE_LABELS[targetType] }}?
    </p>
    <div class="field">
      <label for="type-change-status">Status</label>
      <select id="type-change-status" v-model="statusId" class="select" autofocus>
        <option value="" disabled>– Status wählen –</option>
        <option v-for="s in options" :key="s.id" :value="s.id">{{ s.label }}{{ s.closed ? ' (abgeschlossen)' : '' }}</option>
      </select>
    </div>
    <div v-if="error" class="error-box">{{ error }}</div>
    <template #footer>
      <button class="btn" type="button" @click="emit('close')">Abbrechen</button>
      <button class="btn btn-primary" type="button" :disabled="saving || !statusId" @click="submit">
        {{ type ? 'Typ ändern' : 'Typ zuweisen' }}
      </button>
    </template>
  </ModalDialog>
</template>

<style scoped>
.intro {
  margin: 0;
}
</style>
