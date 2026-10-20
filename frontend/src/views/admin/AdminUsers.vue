<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { api, errorMessage } from '../../api';
import ModalDialog from '../../components/ModalDialog.vue';
import PersonSearch from '../../components/PersonSearch.vue';
import { formatDateTime, ROLE_LABELS } from '../../format';
import { useSession } from '../../stores/session';
import { useToast } from '../../stores/toast';
import type { AdminUser, DirectoryPerson, PersonPick, Role } from '../../types';

const session = useSession();
const toast = useToast();
const users = ref<AdminUser[]>([]);
const filter = ref<'staff' | 'standard' | 'all'>('staff');
const query = ref('');
const ldapEnabled = ref(false);

interface Draft {
  id: string | null;
  name: string;
  email: string;
  /** «auto» = Rolle aus den AD-Gruppen (nur AD-Konten) */
  role: Role | 'auto';
  active: boolean;
  password: string;
  authSource: AdminUser['authSource'];
  hasPassword: boolean;
}
const draft = ref<Draft | null>(null);
const error = ref('');
const saving = ref(false);

/** Neuer Benutzer: aus dem AD (vorab, ohne Anmeldung) oder lokales Konto */
const mode = ref<'directory' | 'local'>('local');
/** Gewählte Person aus dem AD (neuer Benutzer) */
const person = ref<DirectoryPerson | null>(null);
/** Rolle aus den AD-Gruppen, für «Aus AD-Gruppen (zurzeit: …)» */
const adRole = ref<Role | null>(null);
const adLoading = ref(false);
const adError = ref('');

async function load() {
  try {
    users.value = await api.get<AdminUser[]>('/admin/users');
  } catch (err) {
    toast.error(err);
  }
}

onMounted(async () => {
  await load();
  try {
    ldapEnabled.value = (await api.get<{ enabled: boolean }>('/settings/ldap')).enabled;
  } catch {
    ldapEnabled.value = false;
  }
});

const visible = computed(() => {
  const q = query.value.trim().toLowerCase();
  return users.value.filter((u) => {
    if (filter.value === 'staff' && u.role === 'standard') return false;
    if (filter.value === 'standard' && u.role !== 'standard') return false;
    return !q || u.name.toLowerCase().includes(q) || u.email.includes(q);
  });
});

/** Antworten früherer Abfragen (anderer Benutzer, Dialog zu) verwerfen */
let lookupNo = 0;

function resetDirectory() {
  lookupNo++;
  error.value = '';
  person.value = null;
  adRole.value = null;
  adLoading.value = false;
  adError.value = '';
}

function setMode(value: 'directory' | 'local') {
  mode.value = value;
  resetDirectory();
  if (draft.value) {
    draft.value.authSource = value === 'directory' ? 'ldap' : 'local';
    draft.value.role = value === 'directory' ? 'auto' : 'it';
    draft.value.name = '';
    draft.value.email = '';
  }
}

function create() {
  error.value = '';
  draft.value = { id: null, name: '', email: '', role: 'it', active: true, password: '', authSource: 'local', hasPassword: false };
  setMode(ldapEnabled.value ? 'directory' : 'local');
}

/** Fragt die Person im AD ab, mit der Rolle aus den AD-Gruppen */
async function lookup(email: string): Promise<DirectoryPerson | null> {
  const no = ++lookupNo;
  adLoading.value = true;
  adError.value = '';
  try {
    const found = await api.get<DirectoryPerson>(`/admin/users/directory?email=${encodeURIComponent(email)}`);
    if (no !== lookupNo) return null;
    adRole.value = found.role;
    return found;
  } catch (err) {
    if (no === lookupNo) adError.value = errorMessage(err);
    return null;
  } finally {
    if (no === lookupNo) adLoading.value = false;
  }
}

async function pickPerson(pick: PersonPick) {
  const found = await lookup(pick.email);
  if (!found || !draft.value) return;
  error.value = '';
  person.value = found;
  draft.value.name = found.name;
  draft.value.email = found.email;
  draft.value.role = 'auto';
}

function edit(u: AdminUser) {
  error.value = '';
  resetDirectory();
  draft.value = { ...u, role: u.authSource === 'ldap' && !u.roleManual ? 'auto' : u.role, password: '' };
  if (u.authSource === 'ldap') {
    if (!u.roleManual) adRole.value = u.role;
    // Nur für die Anzeige «zurzeit: …»; ohne LDAP gilt die gespeicherte Rolle
    if (ldapEnabled.value) void lookup(u.email);
  }
}

const autoLabel = computed(() => {
  if (adLoading.value) return 'Aus AD-Gruppen (wird abgefragt …)';
  return adRole.value ? `Aus AD-Gruppen (zurzeit: ${ROLE_LABELS[adRole.value]})` : 'Aus AD-Gruppen';
});

const choosingPerson = computed(() => !!draft.value && !draft.value.id && mode.value === 'directory');

async function save() {
  if (!draft.value) return;
  const d = draft.value;
  if (choosingPerson.value && !person.value) {
    error.value = 'Bitte eine Person aus dem AD wählen.';
    return;
  }
  saving.value = true;
  error.value = '';
  try {
    if (d.id) {
      const body: Record<string, unknown> = { name: d.name, email: d.email, role: d.role, active: d.active };
      if (d.password) body.password = d.password;
      await api.patch(`/admin/users/${d.id}`, body);
    } else if (person.value) {
      await api.post('/admin/users/directory', { email: person.value.email, role: d.role });
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
      Standard-Benutzer entstehen automatisch aus Absendern und CC-Empfängern von Mails.
      <template v-if="ldapEnabled">
        Personen aus dem AD lassen sich mit «+ Benutzer» vorab anlegen, z.B. um ihnen Vorgänge zuzuweisen, bevor sie sich
        zum ersten Mal anmelden.
      </template>
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
            <td>
              {{ ROLE_LABELS[u.role] }}
              <span v-if="u.roleManual" class="faint" title="Von Hand festgelegt, gilt statt der AD-Gruppen">· von Hand</span>
            </td>
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
      <div v-if="!draft.id && ldapEnabled" class="segmented">
        <button type="button" :class="{ active: mode === 'directory' }" @click="setMode('directory')">Aus dem AD</button>
        <button type="button" :class="{ active: mode === 'local' }" @click="setMode('local')">Lokales Konto</button>
      </div>
      <template v-if="choosingPerson">
        <div class="field">
          <label>Person im AD</label>
          <div v-if="person" class="picked">
            <div>
              <div>{{ person.name }}</div>
              <div class="faint">{{ person.email }}</div>
            </div>
            <button class="link-btn" type="button" @click="resetDirectory">Andere Person</button>
          </div>
          <PersonSearch v-else directory-only autofocus @pick="pickPerson" />
          <span class="hint">Anmelden kann sich die Person mit ihrem AD-Konto, ein Passwort braucht es nicht.</span>
        </div>
      </template>
      <template v-else>
        <div class="field">
          <label for="u-name">Name</label>
          <input id="u-name" v-model="draft.name" class="input" />
        </div>
        <div class="field">
          <label for="u-email">E-Mail</label>
          <input id="u-email" v-model="draft.email" class="input" type="email" :disabled="draft.authSource === 'ldap'" />
        </div>
      </template>
      <div v-if="!choosingPerson || person" class="field">
        <label for="u-role">Rolle</label>
        <select id="u-role" v-model="draft.role" class="select">
          <option v-if="draft.authSource === 'ldap'" value="auto">{{ autoLabel }}</option>
          <option value="admin">Admin – alles inkl. Verwaltung</option>
          <option value="it">IT – sieht und bearbeitet alle Vorgänge</option>
          <option value="standard">{{ draft.authSource === 'ldap' ? 'Standard – nur Portal' : 'Standard – ohne Anmeldung' }}</option>
        </select>
        <span v-if="draft.authSource === 'ldap'" class="hint">
          Von Hand gewählt bleibt die Rolle bei jeder Anmeldung, «Aus AD-Gruppen» folgt den Gruppen im AD. Name und E-Mail
          kommen bei der Anmeldung aus dem AD.
        </span>
      </div>
      <div v-if="adError" class="error-box">{{ adError }}</div>
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
        <button class="btn btn-primary" type="button" :disabled="saving || (choosingPerson && adLoading)" @click="save">
          Speichern
        </button>
      </template>
    </ModalDialog>
  </div>
</template>

<style scoped>
tr.inactive td {
  color: var(--text-faint);
}
.picked {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 8px 10px;
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
}
</style>
