<script setup lang="ts">
import { onMounted, ref } from 'vue';
import { api, errorMessage } from '../../api';
import ModalDialog from '../../components/ModalDialog.vue';
import { useConfirm } from '../../stores/confirm';
import { useToast } from '../../stores/toast';
import type { ChecklistTemplate } from '../../types';

const toast = useToast();
const confirm = useConfirm();
const templates = ref<ChecklistTemplate[]>([]);
const draft = ref<{ id: string | null; name: string; items: string } | null>(null);
const error = ref('');
const saving = ref(false);

async function load() {
  try {
    templates.value = await api.get<ChecklistTemplate[]>('/checklist-templates');
  } catch (err) {
    toast.error(err);
  }
}
onMounted(load);

function create() {
  error.value = '';
  draft.value = { id: null, name: '', items: '' };
}

function edit(t: ChecklistTemplate) {
  error.value = '';
  draft.value = { id: t.id, name: t.name, items: t.items.join('\n') };
}

async function save() {
  const d = draft.value;
  if (!d) return;
  saving.value = true;
  error.value = '';
  const body = { name: d.name, items: d.items.split('\n').map((l) => l.trim()).filter(Boolean) };
  try {
    if (d.id) await api.put(`/admin/checklist-templates/${d.id}`, body);
    else await api.post('/admin/checklist-templates', body);
    draft.value = null;
    toast.success('Vorlage gespeichert');
    await load();
  } catch (err) {
    error.value = errorMessage(err);
  } finally {
    saving.value = false;
  }
}

async function remove(t: ChecklistTemplate) {
  const ok = await confirm.ask({
    title: 'Vorlage löschen',
    message: `Vorlage «${t.name}» löschen? Bereits eingefügte Checklisten bleiben erhalten.`,
    confirmLabel: 'Löschen',
    danger: true,
  });
  if (!ok) return;
  try {
    await api.delete(`/admin/checklist-templates/${t.id}`);
    await load();
  } catch (err) {
    toast.error(err);
  }
}
</script>

<template>
  <div class="stack">
    <div class="page-head" style="margin: 0">
      <h1>Checklisten-Vorlagen</h1>
      <div class="spacer" />
      <button class="btn btn-primary" type="button" @click="create">+ Vorlage</button>
    </div>
    <p class="muted" style="margin: 0">
      Vorlagen lassen sich in jeder Aufgabe über «Vorlage einfügen» als neue Checkliste übernehmen, z.B. für wiederkehrende Abläufe
      wie «Neuer Mitarbeiter».
    </p>

    <div v-if="!templates.length" class="card empty">Noch keine Vorlagen.</div>
    <div v-for="t in templates" :key="t.id" class="card card-body template">
      <div class="row">
        <h2>{{ t.name }}</h2>
        <span class="faint">{{ t.items.length }} Punkte</span>
        <div class="spacer" />
        <button class="btn btn-sm" type="button" @click="edit(t)">Bearbeiten</button>
        <button class="btn btn-sm btn-danger" type="button" @click="remove(t)">Löschen</button>
      </div>
      <ul class="items">
        <li v-for="(text, i) in t.items" :key="i">{{ text }}</li>
      </ul>
    </div>

    <ModalDialog v-if="draft" :title="draft.id ? 'Vorlage bearbeiten' : 'Neue Vorlage'" @close="draft = null">
      <div class="field">
        <label for="tpl-name">Name</label>
        <input id="tpl-name" v-model="draft.name" class="input" maxlength="200" placeholder="z.B. Neuer Mitarbeiter" autofocus />
        <span class="hint">Wird beim Einfügen zum Titel der Checkliste.</span>
      </div>
      <div class="field">
        <label for="tpl-items">Punkte</label>
        <textarea
          id="tpl-items"
          v-model="draft.items"
          class="textarea"
          rows="10"
          placeholder="Ein Punkt pro Zeile, z.B.&#10;AD-Konto anlegen&#10;Mailbox einrichten&#10;Notebook vorbereiten"
        />
        <span class="hint">Ein Punkt pro Zeile.</span>
      </div>
      <div v-if="error" class="error-box">{{ error }}</div>
      <template #footer>
        <button class="btn" type="button" @click="draft = null">Abbrechen</button>
        <button class="btn btn-primary" type="button" :disabled="saving" @click="save">Speichern</button>
      </template>
    </ModalDialog>
  </div>
</template>

<style scoped>
.template {
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.items {
  margin: 0;
  padding-left: 20px;
  color: var(--text-muted);
}
</style>
