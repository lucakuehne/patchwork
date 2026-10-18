<script setup lang="ts">
import { onBeforeUnmount, onMounted } from 'vue';

defineProps<{ title: string; wide?: boolean }>();
const emit = defineEmits<{ close: [] }>();

function onKey(e: KeyboardEvent) {
  if (e.key === 'Escape') emit('close');
}
onMounted(() => document.addEventListener('keydown', onKey));
onBeforeUnmount(() => document.removeEventListener('keydown', onKey));
</script>

<template>
  <Teleport to="body">
    <div class="backdrop" @mousedown.self="emit('close')">
      <div class="dialog card" :class="{ wide }" role="dialog" aria-modal="true" :aria-label="title">
        <div class="head">
          <h2>{{ title }}</h2>
          <button class="btn btn-ghost btn-icon" type="button" aria-label="Schliessen" @click="emit('close')">✕</button>
        </div>
        <div class="body">
          <slot />
        </div>
        <div v-if="$slots.footer" class="foot">
          <slot name="footer" />
        </div>
      </div>
    </div>
  </Teleport>
</template>

<style scoped>
.backdrop {
  position: fixed;
  inset: 0;
  background: rgb(10 14 20 / 45%);
  display: flex;
  align-items: flex-start;
  justify-content: center;
  padding: 6vh 16px;
  z-index: 200;
  overflow-y: auto;
}
.dialog {
  width: 100%;
  max-width: 520px;
  box-shadow: var(--shadow-lg);
}
.dialog.wide {
  max-width: 760px;
}
.head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 12px 16px;
  border-bottom: 1px solid var(--border);
}
.body {
  padding: 16px;
  display: flex;
  flex-direction: column;
  gap: 12px;
}
.foot {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  padding: 12px 16px;
  border-top: 1px solid var(--border);
}
</style>
