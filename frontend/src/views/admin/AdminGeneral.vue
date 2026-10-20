<script setup lang="ts">
import { onMounted, ref } from 'vue';
import { api } from '../../api';
import PortalSettingsCard from '../../components/PortalSettingsCard.vue';
import { useSession } from '../../stores/session';
import { useToast } from '../../stores/toast';

const session = useSession();
const toast = useToast();
const appName = ref('');
const saving = ref(false);
const fileInput = ref<HTMLInputElement | null>(null);

onMounted(async () => {
  try {
    appName.value = (await api.get<{ appName: string }>('/settings/general')).appName;
  } catch (err) {
    toast.error(err);
  }
});

async function save() {
  saving.value = true;
  try {
    await api.put('/settings/general', { appName: appName.value });
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
        <span class="hint">Erscheint in der Kopfzeile, auf der Anmeldeseite und in Mails.</span>
      </div>
      <div><button class="btn btn-primary" type="button" :disabled="saving" @click="save">Speichern</button></div>
    </div>
    <div class="card card-body stack">
      <h2>Logo</h2>
      <div v-if="session.logoUrl" class="logo-preview"><img :src="session.logoUrl" alt="Logo" /></div>
      <span v-else class="faint">Kein Logo hinterlegt.</span>
      <div class="row">
        <label class="btn">
          Logo hochladen …
          <input ref="fileInput" type="file" accept="image/png,image/jpeg,image/webp,image/gif,image/svg+xml" hidden @change="upload" />
        </label>
        <button v-if="session.logoUrl" class="btn btn-danger" type="button" @click="removeLogo">Entfernen</button>
      </div>
      <span class="hint faint">PNG, JPEG, WebP, GIF oder SVG, höchstens 2 MB.</span>
    </div>
    <PortalSettingsCard />
    <p class="faint small">Den Testbetrieb stellt man unter <RouterLink to="/admin/ausgehende-mails">Ausgehende Mails</RouterLink> ein.</p>
  </div>
</template>

<style scoped>
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
