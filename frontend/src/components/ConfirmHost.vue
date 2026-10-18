<script setup lang="ts">
import { useConfirm } from '../stores/confirm';
import ModalDialog from './ModalDialog.vue';

const confirm = useConfirm();
</script>

<template>
  <ModalDialog v-if="confirm.request" :title="confirm.request.title" @close="confirm.answer(false)">
    <p style="margin: 0">{{ confirm.request.message }}</p>
    <template #footer>
      <button class="btn" type="button" @click="confirm.answer(false)">Abbrechen</button>
      <button
        class="btn"
        :class="confirm.request.danger ? 'btn-danger' : 'btn-primary'"
        type="button"
        autofocus
        @click="confirm.answer(true)"
      >
        {{ confirm.request.confirmLabel }}
      </button>
    </template>
  </ModalDialog>
</template>
