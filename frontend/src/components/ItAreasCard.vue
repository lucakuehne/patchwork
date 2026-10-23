<script setup lang="ts">
import { onMounted, ref } from 'vue';
import { api } from '../api';
import { useSession } from '../stores/session';
import { useToast } from '../stores/toast';
import type { Area } from '../types';

/**
 * Bereiche der Rolle IT (Verwaltung → Benutzer): Eingang, Störungen, Aufgaben, mindestens einer. Admins sehen immer
 * alles. Ohne Zugriff ist ein Vorgang gesperrt, auch per Link; zuständig und erwähnbar bleibt man, erhält aber keine Mails.
 */
const toast = useToast();
const session = useSession();
const AREAS: { key: Area; label: string }[] = [
  { key: 'inbox', label: 'Eingang' },
  { key: 'incident', label: 'Störungen' },
  { key: 'task', label: 'Aufgaben' },
];
const chosen = ref<Area[] | null>(null);
const saving = ref(false);

onMounted(async () => {
  try {
    chosen.value = (await api.get<{ it: Area[] }>('/settings/areas')).it;
  } catch (err) {
    toast.error(err);
  }
});

async function save() {
  if (!chosen.value) return;
  saving.value = true;
  try {
    chosen.value = (await api.put<{ it: Area[] }>('/settings/areas', { it: chosen.value })).it;
    toast.success('Bereiche der IT gespeichert');
    // Gilt auch für «Als dieser Benutzer arbeiten» in anderen Tabs erst nach dem Neuladen; hier für den eigenen Zähler
    void session.refreshCounts();
  } catch (err) {
    toast.error(err);
  } finally {
    saving.value = false;
  }
}
</script>

<template>
  <div class="card card-body stack">
    <h2>Bereiche der IT</h2>
    <span class="hint faint">
      Welche Bereiche Benutzer mit der Rolle IT sehen. Admins sehen immer alles. Ohne Zugriff fehlt der Bereich in Navigation,
      Zählern und Suche, seine Vorgänge sind gesperrt (auch per Link) und erscheinen in Verknüpfungen nur mit der Nummer. IT-Mitarbeitende
      bleiben dort als Zuständige wählbar und erwähnbar, erhalten dazu aber keine Mails.
    </span>
    <div v-if="chosen" class="areas">
      <label v-for="a in AREAS" :key="a.key" class="checkbox">
        <input v-model="chosen" type="checkbox" :value="a.key" />
        {{ a.label }}
      </label>
    </div>
    <span v-if="chosen && !chosen.length" class="hint error-text">Mindestens ein Bereich muss gewählt sein.</span>
    <div v-if="chosen" class="row">
      <button class="btn btn-primary" type="button" :disabled="saving || !chosen.length" @click="save">Speichern</button>
    </div>
  </div>
</template>

<style scoped>
.areas {
  display: flex;
  flex-wrap: wrap;
  gap: 8px 20px;
}
.error-text {
  color: var(--danger);
}
</style>
