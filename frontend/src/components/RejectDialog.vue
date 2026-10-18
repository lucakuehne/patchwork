<script setup lang="ts">
import { ref } from 'vue';
import { api, errorMessage } from '../api';
import { itemRef } from '../format';
import MarkdownEditor from './MarkdownEditor.vue';
import ModalDialog from './ModalDialog.vue';

const props = defineProps<{ number: number; title: string }>();
const emit = defineEmits<{ close: []; done: [] }>();

const reason = ref('');
const notify = ref(false);
const saving = ref(false);
const error = ref('');

async function submit() {
  if (!reason.value.trim()) {
    error.value = 'Bitte eine Begründung angeben.';
    return;
  }
  saving.value = true;
  error.value = '';
  try {
    await api.post(`/items/${props.number}/reject`, { reason: reason.value, notify: notify.value });
    emit('done');
  } catch (err) {
    error.value = errorMessage(err);
  } finally {
    saving.value = false;
  }
}
</script>

<template>
  <ModalDialog :title="`${itemRef(number)} ablehnen`" @close="emit('close')">
    <p class="muted" style="margin: 0">{{ title }}</p>
    <div class="field">
      <span class="label">Begründung</span>
      <MarkdownEditor v-model="reason" :min-height="110" autofocus @submit="submit" />
    </div>
    <label class="checkbox">
      <input v-model="notify" type="checkbox" />
      Melder informieren (Begründung per Mail senden)
    </label>
    <div v-if="error" class="error-box">{{ error }}</div>
    <template #footer>
      <button class="btn" type="button" @click="emit('close')">Abbrechen</button>
      <button class="btn btn-danger" type="button" :disabled="saving" @click="submit">Ablehnen</button>
    </template>
  </ModalDialog>
</template>
