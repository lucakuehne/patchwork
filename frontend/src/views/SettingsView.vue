<script setup lang="ts">
import { computed } from 'vue';
import { useSession } from '../stores/session';
import { useToast } from '../stores/toast';
import type { Area, ListLayout, OpenMode, Preferences } from '../types';

/**
 * Persönliche Einstellungen (Benutzermenü): Liste oder Board für offene Störungen und Aufgaben, Vorgang als Seite oder
 * im Fenster öffnen je Typ. Gespeichert pro Benutzer, wirksam sofort. Nur Bereiche, die man sieht.
 */
const session = useSession();
const toast = useToast();

const LAYOUTS: { value: ListLayout; label: string }[] = [
  { value: 'list', label: 'Liste' },
  { value: 'board', label: 'Board' },
];
const OPEN_MODES: { value: OpenMode; label: string }[] = [
  { value: 'page', label: 'Seite' },
  { value: 'modal', label: 'Fenster' },
];

const layoutRows = computed(() =>
  (
    [
      { key: 'incidents', area: 'incident', label: 'Offene Störungen' },
      { key: 'tasks', area: 'task', label: 'Offene Aufgaben' },
    ] as { key: keyof Preferences['layout']; area: Area; label: string }[]
  ).filter((r) => session.areas.includes(r.area)),
);
const openRows = computed(() =>
  (
    [
      { key: 'inbox', label: 'Vorgänge im Eingang' },
      { key: 'incident', label: 'Störungen' },
      { key: 'task', label: 'Aufgaben' },
    ] as { key: keyof Preferences['open']; label: string }[]
  ).filter((r) => session.areas.includes(r.key)),
);

async function save(patch: Parameters<typeof session.savePreferences>[0]) {
  try {
    await session.savePreferences(patch);
    toast.success('Gespeichert');
  } catch (err) {
    toast.error(err);
  }
}
</script>

<template>
  <div class="page settings">
    <div class="page-head">
      <h1>Einstellungen</h1>
    </div>

    <div v-if="layoutRows.length" class="card card-body stack">
      <h2>Ansicht</h2>
      <div v-for="r in layoutRows" :key="r.key" class="setting">
        <span class="setting-label">{{ r.label }}</span>
        <div class="segmented" role="group" :aria-label="r.label">
          <button
            v-for="o in LAYOUTS"
            :key="o.value"
            type="button"
            :class="{ active: session.preferences.layout[r.key] === o.value }"
            :aria-pressed="session.preferences.layout[r.key] === o.value"
            @click="session.preferences.layout[r.key] !== o.value && save({ layout: { [r.key]: o.value } })"
          >
            {{ o.label }}
          </button>
        </div>
      </div>
      <span class="hint faint">Umschalten geht auch direkt in der Ansicht. Erledigte und gelöste Vorgänge sind immer eine Liste.</span>
    </div>

    <div class="card card-body stack">
      <h2>Vorgang öffnen als</h2>
      <div v-for="r in openRows" :key="r.key" class="setting">
        <span class="setting-label">{{ r.label }}</span>
        <div class="segmented" role="group" :aria-label="r.label">
          <button
            v-for="o in OPEN_MODES"
            :key="o.value"
            type="button"
            :class="{ active: session.preferences.open[r.key] === o.value }"
            :aria-pressed="session.preferences.open[r.key] === o.value"
            @click="session.preferences.open[r.key] !== o.value && save({ open: { [r.key]: o.value } })"
          >
            {{ o.label }}
          </button>
        </div>
      </div>
      <span class="hint faint">
        «Fenster» öffnet den Vorgang gross über der aktuellen Ansicht, «Zurück» oder Escape schliessen ihn. Ctrl+Klick
        öffnet wie gewohnt einen neuen Tab, Links aus Mails immer die Seite.
      </span>
    </div>
  </div>
</template>

<style scoped>
.settings {
  max-width: 720px;
  display: flex;
  flex-direction: column;
  gap: 16px;
}
.settings .page-head {
  margin-bottom: 0;
}
.setting {
  display: flex;
  align-items: center;
  gap: 12px;
  flex-wrap: wrap;
}
.setting-label {
  min-width: 180px;
  flex: 1;
}
</style>
