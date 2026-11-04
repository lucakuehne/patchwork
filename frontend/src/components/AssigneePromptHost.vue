<script setup lang="ts">
import { ref, watch } from 'vue';
import { useAssigneePrompt } from '../stores/assignee-prompt';
import { useSession } from '../stores/session';
import ModalDialog from './ModalDialog.vue';

const prompt = useAssigneePrompt();
const session = useSession();
// Nichts vorgewählt: man soll aktiv jemanden wählen (Entscheid vom 04.11.2026)
const chosen = ref('');
watch(
  () => prompt.message,
  () => (chosen.value = ''),
);
</script>

<template>
  <ModalDialog v-if="prompt.message" title="Wer ist zuständig?" @close="prompt.answer(null)">
    <p style="margin: 0">{{ prompt.message }}</p>
    <div class="field">
      <label for="assignee-prompt" class="label">Zuständig</label>
      <select id="assignee-prompt" v-model="chosen" class="select" autofocus>
        <option value="" disabled>Bitte wählen …</option>
        <option v-for="u in session.staff" :key="u.id" :value="u.id">{{ u.name }}</option>
      </select>
    </div>
    <template #footer>
      <button class="btn" type="button" @click="prompt.answer(null)">Abbrechen</button>
      <button class="btn btn-primary" type="button" :disabled="!chosen" @click="prompt.answer(chosen)">OK</button>
    </template>
  </ModalDialog>
</template>
