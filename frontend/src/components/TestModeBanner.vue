<script setup lang="ts">
import { useSession } from '../stores/session';

/**
 * Hinweis für alle Benutzer, solange der Testbetrieb nicht alle Mails versendet. Immer derselbe allgemeine Satz, nicht
 * je Block (Entscheid vom 29.10.2026); wer was bekommt, steht unter Verwaltung → Ausgehende Mails.
 */
const session = useSession();
</script>

<template>
  <div v-if="session.info?.testMode" class="test-mode" role="status">
    <strong>Testbetrieb:</strong> Es werden nicht alle Mails versendet.
    <RouterLink v-if="session.isAdmin" to="/admin/outgoing-mails?status=withheld">Nicht versendete Mails ansehen</RouterLink>
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
