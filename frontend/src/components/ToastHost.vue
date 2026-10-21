<script setup lang="ts">
import { useToast } from '../stores/toast';

const toast = useToast();
</script>

<template>
  <div class="toasts" aria-live="polite">
    <div v-for="t in toast.toasts" :key="t.id" class="toast" :class="t.kind" @click="toast.dismiss(t.id)">
      {{ t.text }}
      <RouterLink v-if="t.link" class="toast-link" :to="t.link.to" @click="toast.dismiss(t.id)">{{ t.link.text }}</RouterLink>
    </div>
  </div>
</template>

<style scoped>
.toasts {
  position: fixed;
  right: 16px;
  bottom: 16px;
  display: flex;
  flex-direction: column;
  gap: 8px;
  z-index: 1000;
  max-width: 420px;
}
.toast {
  padding: 10px 14px;
  border-radius: var(--radius);
  background: var(--surface);
  border: 1px solid var(--border);
  box-shadow: var(--shadow-lg);
  cursor: pointer;
  border-left: 4px solid var(--success);
}
.toast.error {
  border-left-color: var(--danger);
}
.toast-link {
  margin-left: 10px;
  font-weight: 500;
}
</style>
