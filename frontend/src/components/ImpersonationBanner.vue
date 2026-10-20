<script setup lang="ts">
import { ref } from 'vue';
import { api } from '../api';
import { useSession } from '../stores/session';
import { useToast } from '../stores/toast';
import type { User } from '../types';

/** Auffälliger Balken, solange ein Admin als anderer Benutzer arbeitet, mit dem Weg zurück. */
const session = useSession();
const toast = useToast();
const busy = ref(false);

async function back() {
  busy.value = true;
  try {
    const admin = await api.post<User>('/auth/impersonation/end');
    session.announceSessionChange(admin.id, null);
    // Neu laden, damit Stammdaten, Zähler und Rechte wieder dem eigenen Konto entsprechen
    window.location.assign('/admin/benutzer');
  } catch (err) {
    // z.B. Sitzung inzwischen beendet (Passwort des Admins geändert): neu laden zeigt den tatsächlichen Stand
    toast.error(err);
    window.setTimeout(() => window.location.reload(), 1500);
  }
}
</script>

<template>
  <div v-if="session.impersonator && session.user" class="impersonation" role="status">
    Sie arbeiten als <strong>{{ session.user.name }}</strong>. Antworten, Notizen und Änderungen erscheinen unter diesem Namen.
    <button class="back" type="button" :disabled="busy" @click="back">Zurück zu {{ session.impersonator.name }}</button>
  </div>
</template>

<style scoped>
.impersonation {
  padding: 8px 16px;
  /* fest dunkelrot: --danger ist im dunklen Schema für Schrift aufgehellt, weiss darauf wäre schlecht lesbar */
  background: #b42318;
  color: #fff;
  font-size: 13px;
  text-align: center;
}
.back {
  margin-left: 10px;
  padding: 3px 10px;
  border: 1px solid rgba(255, 255, 255, 0.7);
  border-radius: var(--radius-sm);
  background: transparent;
  color: #fff;
  font: inherit;
  font-weight: 600;
  cursor: pointer;
}
.back:hover {
  background: rgba(255, 255, 255, 0.15);
}
</style>
