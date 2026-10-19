<script setup lang="ts">
import { useSession } from '../stores/session';

/** Hinweis für alle Benutzer, solange der Testbetrieb läuft. */
const session = useSession();
</script>

<template>
  <div v-if="session.info?.testMode" class="test-mode" role="status">
    <strong>Testbetrieb:</strong> Es werden keine Mails versendet.
    <RouterLink v-if="session.isAdmin" to="/admin/nicht-versendet">Nicht versendete Mails ansehen</RouterLink>
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
