<script setup lang="ts">
import { onMounted, ref } from 'vue';
import { api } from '../../api';
import PortalSettingsCard from '../../components/PortalSettingsCard.vue';
import { useSession } from '../../stores/session';
import { useToast } from '../../stores/toast';

const session = useSession();
const toast = useToast();
const appName = ref('');
/** Abgeschlossene Spalten der Boards: Vorgänge der letzten so vielen Tage (Entscheid vom 11.11.2026) */
const boardClosedDays = ref(5);
const saving = ref(false);
const fileInput = ref<HTMLInputElement | null>(null);

onMounted(async () => {
  try {
    const general = await api.get<{ appName: string; boardClosedDays: number }>('/settings/general');
    appName.value = general.appName;
    boardClosedDays.value = general.boardClosedDays;
  } catch (err) {
    toast.error(err);
  }
});

async function save() {
  saving.value = true;
  try {
    await api.put('/settings/general', { appName: appName.value, boardClosedDays: Number(boardClosedDays.value) });
    await session.loadInfo();
    toast.success('Gespeichert');
  } catch (err) {
    toast.error(err);
  } finally {
    saving.value = false;
  }
}

async function upload(e: Event) {
  const file = (e.target as HTMLInputElement).files?.[0];
  if (!file) return;
  const form = new FormData();
  form.append('file', file, file.name);
  try {
    await api.post('/settings/logo', form);
    await session.loadInfo();
    toast.success('Logo gespeichert');
  } catch (err) {
    toast.error(err);
  } finally {
    if (fileInput.value) fileInput.value.value = '';
  }
}

async function removeLogo() {
  try {
    await api.delete('/settings/logo');
    await session.loadInfo();
    toast.success('Logo entfernt');
  } catch (err) {
    toast.error(err);
  }
}
</script>

<template>
  <div class="stack">
    <h1>Allgemein</h1>
    <div class="card card-body stack">
      <div class="field">
        <label for="app-name">Name der Anwendung</label>
        <input id="app-name" v-model="appName" class="input" maxlength="100" />
        <span class="hint">
          Erscheint im Browser-Tab, in Auswertungen und als Absender von Mails, wenn das Postfach keinen Namen hat. Kopfzeile
          und Anmeldeseite zeigen das Logo.
        </span>
      </div>
      <div class="field">
        <label for="board-days">Tage in den abgeschlossenen Spalten der Boards</label>
        <input id="board-days" v-model.number="boardClosedDays" class="input days" type="number" min="1" max="60" step="1" />
        <span class="hint">
          «Erledigt» im Board der Aufgaben und «Gelöst» im Board der Störungen zeigen die Vorgänge, die in den letzten so
          vielen Tagen abgeschlossen wurden (1 bis 60). Alle findet man unter «Erledigt» bzw. «Gelöst».
        </span>
      </div>
      <div><button class="btn btn-primary" type="button" :disabled="saving" @click="save">Speichern</button></div>
    </div>
    <div class="card card-body stack">
      <h2>Logo</h2>
      <div v-if="session.logoUrl" class="logo-preview"><img :src="session.logoUrl" alt="Logo" /></div>
      <span v-else class="faint">Kein eigenes Logo hinterlegt, es erscheint das Patchwork-Logo.</span>
      <div class="row">
        <label class="btn">
          Logo hochladen …
          <input ref="fileInput" type="file" accept="image/png,image/jpeg,image/webp,image/gif,image/svg+xml" hidden @change="upload" />
        </label>
        <button v-if="session.logoUrl" class="btn btn-danger" type="button" @click="removeLogo">Entfernen</button>
      </div>
      <span class="hint faint">
        Ersetzt das Patchwork-Logo in Kopfzeile, Portal und Anmeldeseite. PNG, JPEG, WebP, GIF oder SVG, höchstens 2 MB.
      </span>
    </div>
    <PortalSettingsCard />
    <p class="faint small">Den Testbetrieb stellt man unter <RouterLink to="/admin/outgoing-mails">Ausgehende Mails</RouterLink> ein.</p>
  </div>
</template>

<style scoped>
.days {
  max-width: 120px;
}
.logo-preview {
  padding: 12px;
  border: 1px dashed var(--border-strong);
  border-radius: var(--radius-sm);
  display: inline-flex;
  align-self: flex-start;
}
.logo-preview img {
  max-height: 64px;
  max-width: 240px;
}
.small {
  font-size: 12px;
  margin: 0;
}
</style>
