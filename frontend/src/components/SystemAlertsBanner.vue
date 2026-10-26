<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { useRoute } from 'vue-router';
import { api } from '../api';
import { formatDateTime } from '../format';
import { useSession } from '../stores/session';
import type { SystemAlerts } from '../types';

/**
 * Hinweise bei Störungen, nur für Admins (Entscheid vom 26.10.2026): Mail-Abruf seit mindestens 60 Minuten gestört,
 * fehlgeschlagene ausgehende Mails (bis erneut gesendet oder als erledigt markiert), wenig Speicherplatz.
 * Lädt beim Seitenwechsel und jede Minute neu.
 */
const session = useSession();
const route = useRoute();
const alerts = ref<SystemAlerts | null>(null);

async function load() {
  if (!session.isAdmin) return;
  try {
    alerts.value = await api.get<SystemAlerts>('/admin/alerts');
  } catch {
    // z.B. offline oder abgemeldet; der nächste Versuch zeigt es wieder
  }
}

let timer: number | undefined;
onMounted(() => {
  void load();
  timer = window.setInterval(() => void load(), 60_000);
});
onBeforeUnmount(() => window.clearInterval(timer));
watch(() => route.fullPath, () => void load());

const gb = (bytes: number) => `${(bytes / 1024 ** 3).toFixed(1).replace('.', ',')} GB`;
</script>

<template>
  <template v-if="session.isAdmin && alerts">
    <div v-for="m in alerts.mailboxes" :key="m.id" class="alert" role="alert">
      <strong>Mail-Abruf gestört:</strong> Postfach «{{ m.name }}» seit {{ formatDateTime(m.since) }} ({{ m.error }}).
      <RouterLink to="/admin/postfaecher">Postfächer</RouterLink>
    </div>
    <div v-if="alerts.failedMails > 0" class="alert" role="alert">
      <strong>Versand:</strong>
      {{ alerts.failedMails === 1 ? '1 Mail ist' : `${alerts.failedMails} Mails sind` }} fehlgeschlagen.
      <RouterLink :to="{ path: '/admin/ausgehende-mails', query: { status: 'fehler' } }">Ausgehende Mails</RouterLink>
    </div>
    <div v-if="alerts.disk" class="alert" role="alert">
      <strong>Wenig Speicherplatz:</strong> noch {{ String(alerts.disk.freePercent).replace('.', ',') }} % frei
      ({{ gb(alerts.disk.freeBytes) }} von {{ gb(alerts.disk.totalBytes) }}) auf dem Datenträger der Ablage.
    </div>
  </template>
</template>

<style scoped>
.alert {
  padding: 6px 16px;
  background: var(--danger-soft);
  color: var(--danger);
  border-bottom: 1px solid var(--border);
  font-size: 13px;
  text-align: center;
  overflow-wrap: anywhere;
}
.alert a {
  margin-left: 8px;
  font-weight: 500;
}
</style>
