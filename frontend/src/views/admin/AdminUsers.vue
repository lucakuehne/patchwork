<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { api, errorMessage } from '../../api';
import ModalDialog from '../../components/ModalDialog.vue';
import { formatDateTime, ROLE_LABELS } from '../../format';
import { useSession } from '../../stores/session';
import { useToast } from '../../stores/toast';
import type { AdminUser, Role } from '../../types';

const session = useSession();
const toast = useToast();
const users = ref<AdminUser[]>([]);
const filter = ref<'staff' | 'standard' | 'all'>('staff');
const query = ref('');

interface Draft {
  id: string | null;
  name: string;
  email: string;
  role: Role;
  active: boolean;
  password: string;
  authSource: AdminUser['authSource'];
  hasPassword: boolean;
}
const draft = ref<Draft | null>(null);
const error = ref('');
const saving = ref(false);

async function load() {
  try {
    users.value = await api.get<AdminUser[]>('/admin/users');
  } catch (err) {
    toast.error(err);
  }
}
onMounted(load);

const visible = computed(() => {
  const q = query.value.trim().toLowerCase();
  return users.value.filter((u) => {
    if (filter.value === 'staff' && u.role === 'standard') return false;
    if (filter.value === 'standard' && u.role !== 'standard') return false;
    return !q || u.name.toLowerCase().includes(q) || u.email.includes(q);
  });
});

function create() {
  error.value = '';
  draft.value = { id: null, name: '', email: '', role: 'it', active: true, password: '', authSource: 'local', hasPassword: false };
}

function edit(u: AdminUser) {
  error.value = '';
  draft.value = { ...u, password: '' };
}

async function save() {
  if (!draft.value) return;
  saving.value = true;
  error.value = '';
  const d = draft.value;
  try {
    if (d.id) {
      const body: Record<string, unknown> = { name: d.name, email: d.email, role: d.role, active: d.active };
      if (d.password) body.password = d.password;
      await api.patch(`/admin/users/${d.id}`, body);
    } else {
      await api.post('/admin/users', { name: d.name, email: d.email, role: d.role, password: d.password || undefined });
    }
    draft.value = null;
    toast.success('Gespeichert');
    await Promise.all([load(), session.loadStaff()]);
  } catch (err) {
    error.value = errorMessage(err);
  } finally {
    saving.value = false;
  }
}

async function removePassword() {
  if (!draft.value?.id) return;
  try {
    await api.patch(`/admin/users/${draft.value.id}`, { password: '' });
    draft.value.hasPassword = false;
    toast.success('Passwort entfernt, Anmeldung nicht mehr möglich');
    await load();
  } catch (err) {
    toast.error(err);
  }
}
</script>

<template>
  <div class="stack">
    <div class="page-head" style="margin: 0">
      <h1>Benutzer</h1>
      <div class="segmented">
        <button type="button" :class="{ active: filter === 'staff' }" @click="filter = 'staff'">Admin &amp; IT</button>
        <button type="button" :class="{ active: filter === 'standard' }" @click="filter = 'standard'">Standard</button>
        <button type="button" :class="{ active: filter === 'all' }" @click="filter = 'all'">Alle</button>
      </div>
      <input v-model="query" class="input" style="max-width: 240px" type="search" placeholder="Suchen" />
      <div class="spacer" />
      <button class="btn btn-primary" type="button" @click="create">+ Benutzer</button>
    </div>
    <p class="muted" style="margin: 0">
      Standard-Benutzer entstehen automatisch aus Absendern und CC-Empfängern von Mails. Anmelden können sich nur Admin und IT.
    </p>
    <div class="card table-wrap">
      <table class="table">
        <thead>
          <tr>
            <th>Name</th>
            <th>E-Mail</th>
            <th>Rolle</th>
            <th>Anmeldung</th>
            <th>Letzte Anmeldung</th>
            <th />
          </tr>
        </thead>
        <tbody>
          <tr v-for="u in visible" :key="u.id" class="clickable" :class="{ inactive: !u.active }" @click="edit(u)">
            <td>{{ u.name }} <span v-if="!u.active" class="badge">deaktiviert</span></td>
            <td>{{ u.email }}</td>
            <td>{{ ROLE_LABELS[u.role] }}</td>
            <td>
              <span v-if="u.authSource === 'ldap'">LDAP</span>
              <span v-else-if="u.hasPassword">Lokal</span>
              <span v-else class="faint">ohne Login</span>
            </td>
            <td class="muted">{{ formatDateTime(u.lastLoginAt) }}</td>
            <td><button class="btn btn-sm btn-ghost" type="button">Bearbeiten</button></td>
          </tr>
        </tbody>
      </table>
      <div v-if="!visible.length" class="empty">Keine Benutzer</div>
    </div>

    <ModalDialog v-if="draft" :title="draft.id ? 'Benutzer bearbeiten' : 'Neuer Benutzer'" @close="draft = null">
      <div class="field">
        <label for="u-name">Name</label>
        <input id="u-name" v-model="draft.name" class="input" />
      </div>
      <div class="field">
        <label for="u-email">E-Mail</label>
        <input id="u-email" v-model="draft.email" class="input" type="email" :disabled="draft.authSource === 'ldap'" />
      </div>
      <div class="field">
        <label for="u-role">Rolle</label>
        <select id="u-role" v-model="draft.role" class="select" :disabled="draft.authSource === 'ldap'">
          <option value="admin">Admin – alles inkl. Verwaltung</option>
          <option value="it">IT – sieht und bearbeitet alle Vorgänge</option>
          <option value="standard">Standard – ohne Anmeldung</option>
        </select>
        <span v-if="draft.authSource === 'ldap'" class="hint">Rolle und E-Mail werden bei jeder Anmeldung aus dem Verzeichnis übernommen.</span>
      </div>
      <div v-if="draft.authSource === 'local'" class="field">
        <label for="u-pass">{{ draft.hasPassword ? 'Neues Passwort' : 'Passwort' }}</label>
        <input id="u-pass" v-model="draft.password" class="input" type="password" autocomplete="new-password" />
        <span class="hint">
          Mindestens 10 Zeichen.
          <template v-if="draft.hasPassword">Leer lassen, um das Passwort zu behalten.</template>
          <template v-else-if="draft.role !== 'standard'">Ohne Passwort ist keine Anmeldung möglich.</template>
        </span>
        <button v-if="draft.id && draft.hasPassword" class="btn btn-sm btn-danger" style="align-self: flex-start" type="button" @click="removePassword">
          Passwort entfernen
        </button>
      </div>
      <label v-if="draft.id" class="checkbox">
        <input v-model="draft.active" type="checkbox" />
        Aktiv (deaktivierte Benutzer können sich nicht anmelden und erhalten keine Mails)
      </label>
      <div v-if="error" class="error-box">{{ error }}</div>
      <template #footer>
        <button class="btn" type="button" @click="draft = null">Abbrechen</button>
        <button class="btn btn-primary" type="button" :disabled="saving" @click="save">Speichern</button>
      </template>
    </ModalDialog>
  </div>
</template>

<style scoped>
tr.inactive td {
  color: var(--text-faint);
}
</style>
