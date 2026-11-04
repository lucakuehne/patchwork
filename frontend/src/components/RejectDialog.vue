<script setup lang="ts">
import { ref } from 'vue';
import { api, errorMessage } from '../api';
import { itemRef } from '../format';
import type { ItemKey } from '../item-ref';
import { useSession } from '../stores/session';
import MarkdownEditor from './MarkdownEditor.vue';
import ModalDialog from './ModalDialog.vue';

/** «askAssignee»: Der Ablehnen-Status verlangt einen Zuständigen und der Vorgang hat keinen (Entscheid vom 04.11.2026) */
const props = defineProps<{ itemKey: ItemKey; title: string; askAssignee?: boolean }>();
const emit = defineEmits<{ close: []; done: [] }>();
const session = useSession();

const reason = ref('');
const notify = ref(false);
// Nichts vorgewählt: man soll aktiv jemanden wählen
const assigneeId = ref('');
const saving = ref(false);
const uploading = ref(false);
const error = ref('');

async function submit() {
  if (!reason.value.trim()) {
    error.value = 'Bitte eine Begründung angeben.';
    return;
  }
  if (props.askAssignee && !assigneeId.value) {
    error.value = 'Bitte wählen, wer zuständig ist.';
    return;
  }
  saving.value = true;
  error.value = '';
  try {
    await api.post(`/items/${itemRef(props.itemKey)}/reject`, {
      reason: reason.value,
      notify: notify.value,
      ...(props.askAssignee ? { assigneeId: assigneeId.value } : {}),
    });
    emit('done');
  } catch (err) {
    error.value = errorMessage(err);
  } finally {
    saving.value = false;
  }
}
</script>

<template>
  <ModalDialog :title="`${itemRef(itemKey)} ablehnen`" @close="emit('close')">
    <p class="muted" style="margin: 0">{{ title }}</p>
    <div class="field">
      <span class="label">Begründung</span>
      <MarkdownEditor v-model="reason" v-model:uploading="uploading" :min-height="110" autofocus @submit="submit" />
    </div>
    <div v-if="askAssignee" class="field">
      <label for="reject-assignee" class="label">Zuständig</label>
      <select id="reject-assignee" v-model="assigneeId" class="select" required>
        <option value="" disabled>Bitte wählen …</option>
        <option v-for="u in session.staff" :key="u.id" :value="u.id">{{ u.name }}</option>
      </select>
    </div>
    <label class="checkbox">
      <input v-model="notify" type="checkbox" />
      Melder informieren (Begründung per Mail senden)
    </label>
    <div v-if="error" class="error-box">{{ error }}</div>
    <template #footer>
      <button class="btn" type="button" @click="emit('close')">Abbrechen</button>
      <button class="btn btn-danger" type="button" :disabled="saving || uploading" @click="submit">Ablehnen</button>
    </template>
  </ModalDialog>
</template>
