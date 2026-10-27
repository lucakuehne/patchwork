<script setup lang="ts">
import { useSession } from '../stores/session';
import { useToast } from '../stores/toast';
import type { ListLayout, Preferences } from '../types';

/** Umschalter «Liste | Board» der offenen Störungen bzw. Aufgaben, pro Benutzer gespeichert (Einstellungen). */
const props = defineProps<{ kind: keyof Preferences['layout'] }>();
const session = useSession();
const toast = useToast();

const OPTIONS: { value: ListLayout; label: string }[] = [
  { value: 'list', label: 'Liste' },
  { value: 'board', label: 'Board' },
];

async function choose(layout: ListLayout) {
  if (session.preferences.layout[props.kind] === layout) return;
  try {
    await session.savePreferences({ layout: { [props.kind]: layout } });
  } catch (err) {
    toast.error(err);
  }
}
</script>

<template>
  <div class="segmented" role="group" aria-label="Ansicht">
    <button
      v-for="o in OPTIONS"
      :key="o.value"
      type="button"
      :class="{ active: session.preferences.layout[kind] === o.value }"
      :aria-pressed="session.preferences.layout[kind] === o.value"
      @click="choose(o.value)"
    >
      {{ o.label }}
    </button>
  </div>
</template>
