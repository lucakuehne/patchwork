<script setup lang="ts">
import { onMounted, ref } from 'vue';
import { api } from '../api';
import { TYPE_LABELS } from '../format';
import { useSession } from '../stores/session';
import { useToast } from '../stores/toast';
import { examplesFromText, TYPE_GUIDE_LIMITS } from '../type-guide';
import type { ItemType, TypeGuide } from '../types';

/**
 * Verwaltung → Allgemein, Karte «Typ wählen» (Entscheid vom 16.11.2026): je Typ die Leitfrage, die in jedem Knopf
 * «Störung» bzw. «Aufgabe» steht, und Beispiele (eines pro Zeile), die beim Darüberfahren erscheinen.
 */
const session = useSession();
const toast = useToast();
const TYPES: ItemType[] = ['incident', 'task'];
const form = ref<Record<ItemType, { hint: string; examples: string }> | null>(null);
const saving = ref(false);

const toForm = (guide: TypeGuide) =>
  Object.fromEntries(TYPES.map((t) => [t, { hint: guide[t].hint, examples: guide[t].examples.join('\n') }])) as Record<
    ItemType,
    { hint: string; examples: string }
  >;

onMounted(async () => {
  try {
    form.value = toForm(await api.get<TypeGuide>('/settings/type-guide'));
  } catch (err) {
    toast.error(err);
  }
});

async function save() {
  if (!form.value) return;
  saving.value = true;
  try {
    const body = Object.fromEntries(
      TYPES.map((t) => [t, { hint: form.value![t].hint, examples: examplesFromText(form.value![t].examples) }]),
    ) as TypeGuide;
    const saved = await api.put<TypeGuide>('/settings/type-guide', body);
    form.value = toForm(saved);
    session.typeGuide = saved;
    toast.success('Gespeichert');
  } catch (err) {
    toast.error(err);
  } finally {
    saving.value = false;
  }
}
</script>

<template>
  <div class="card card-body stack type-guide">
    <h2>Typ wählen</h2>
    <span class="hint faint">
      Die Leitfrage steht in jedem Knopf «Störung» bzw. «Aufgabe» (Eingang, Vorgang, «+ Neu»), die Beispiele erscheinen beim
      Darüberfahren. Ein Beispiel pro Zeile, höchstens {{ TYPE_GUIDE_LIMITS.examples }}.
    </span>
    <div v-if="form" class="types">
      <div v-for="t in TYPES" :key="t" class="stack type">
        <h3>{{ TYPE_LABELS[t] }}</h3>
        <div class="field">
          <label :for="`guide-${t}-hint`">Leitfrage</label>
          <input :id="`guide-${t}-hint`" v-model="form[t].hint" class="input" :maxlength="TYPE_GUIDE_LIMITS.hint" />
        </div>
        <div class="field">
          <label :for="`guide-${t}-examples`">Beispiele</label>
          <textarea :id="`guide-${t}-examples`" v-model="form[t].examples" class="textarea" rows="5" />
        </div>
      </div>
    </div>
    <div><button class="btn btn-primary" type="button" :disabled="saving || !form" @click="save">Speichern</button></div>
  </div>
</template>

<style scoped>
.types {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(260px, 1fr));
  gap: 16px 24px;
}
.type h3 {
  margin: 0;
  font-size: 14px;
}
textarea {
  resize: vertical;
}
</style>
