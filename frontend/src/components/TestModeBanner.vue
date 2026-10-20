<script setup lang="ts">
import { computed } from 'vue';
import { useSession } from '../stores/session';
import { testModeText } from '../test-mode';

/** Hinweis für alle Benutzer, solange der Testbetrieb nicht alle Mails versendet. */
const session = useSession();
const text = computed(() => testModeText(session.info?.delivery));
</script>

<template>
  <div v-if="text" class="test-mode" role="status">
    <strong>Testbetrieb:</strong> {{ text }}
    <RouterLink v-if="session.isAdmin" to="/admin/ausgehende-mails?status=nicht-versendet">Nicht versendete Mails ansehen</RouterLink>
  </div>
</template>

<style scoped>
.test-mode {
  padding: 6px 16px;
  background: var(--warning-soft);
  color: var(--warning);
  border-bottom: 1px solid var(--border);
  font-size: 13px;
  text-align: center;
}
.test-mode a {
  margin-left: 8px;
  font-weight: 500;
}
</style>
