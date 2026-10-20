<script setup lang="ts">
import { computed } from 'vue';
import { formatDate } from '../format';
import { useSession } from '../stores/session';

/** Hinweis für Admins ab 30 Tagen vor Ablauf des HTTPS-Zertifikats. */
const session = useSession();
const DAY = 24 * 60 * 60 * 1000;

const days = computed(() => {
  const expiresAt = session.info?.certificateExpiresAt;
  return expiresAt ? Math.floor((new Date(expiresAt).getTime() - Date.now()) / DAY) : null;
});
</script>

<template>
  <div v-if="session.isAdmin && days !== null && days <= 30" class="certificate" role="status">
    <strong>HTTPS-Zertifikat:</strong>
    <template v-if="days < 0"> ist am {{ formatDate(session.info!.certificateExpiresAt!) }} abgelaufen.</template>
    <template v-else> läuft am {{ formatDate(session.info!.certificateExpiresAt!) }} ab (noch {{ days }} {{ days === 1 ? 'Tag' : 'Tage' }}).</template>
    <RouterLink to="/admin/https">Neues Zertifikat anfordern</RouterLink>
  </div>
</template>

<style scoped>
.certificate {
  padding: 6px 16px;
  background: var(--danger-soft);
  color: var(--danger);
  border-bottom: 1px solid var(--border);
  font-size: 13px;
  text-align: center;
}
.certificate a {
  margin-left: 8px;
  font-weight: 500;
}
</style>
