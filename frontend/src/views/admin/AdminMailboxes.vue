<script setup lang="ts">
import { onMounted, ref } from 'vue';
import { api, errorMessage } from '../../api';
import ModalDialog from '../../components/ModalDialog.vue';
import { formatDateTime } from '../../format';
import { useSession } from '../../stores/session';
import { useToast } from '../../stores/toast';
import type { Mailbox } from '../../types';

const session = useSession();
const toast = useToast();
const mailboxes = ref<Mailbox[]>([]);
const busyId = ref<string | null>(null);
const testResult = ref<Record<string, { ok: boolean; imap: string; smtp: string }>>({});

interface Draft {
  id: string | null;
  name: string;
  address: string;
  active: boolean;
  isDefault: boolean;
  imapHost: string;
  imapPort: number;
  imapSecure: boolean;
  imapFolder: string;
  smtpHost: string;
  smtpPort: number;
  smtpSecurity: 'tls' | 'starttls' | 'none';
  authType: 'password' | 'oauth2';
  username: string;
  password: string;
  oauthTokenUrl: string;
  oauthClientId: string;
  oauthClientSecret: string;
  oauthScope: string;
  hasPassword: boolean;
  hasClientSecret: boolean;
  tenantId: string;
}
const draft = ref<Draft | null>(null);
const error = ref('');
const saving = ref(false);

async function load() {
  try {
    mailboxes.value = await api.get<Mailbox[]>('/admin/mailboxes');
  } catch (err) {
    toast.error(err);
  }
}
onMounted(load);

function create() {
  error.value = '';
  draft.value = {
    id: null,
    name: '',
    address: '',
    active: true,
    isDefault: mailboxes.value.length === 0,
    imapHost: '',
    imapPort: 993,
    imapSecure: true,
    imapFolder: 'INBOX',
    smtpHost: '',
    smtpPort: 587,
    smtpSecurity: 'starttls',
    authType: 'password',
    username: '',
    password: '',
    oauthTokenUrl: '',
    oauthClientId: '',
    oauthClientSecret: '',
    oauthScope: '',
    hasPassword: false,
    hasClientSecret: false,
    tenantId: '',
  };
}

function edit(m: Mailbox) {
  error.value = '';
  const tenant = m.oauthTokenUrl?.match(/login\.microsoftonline\.com\/([^/]+)\//)?.[1] ?? '';
  draft.value = {
    ...m,
    password: '',
    oauthTokenUrl: m.oauthTokenUrl ?? '',
    oauthClientId: m.oauthClientId ?? '',
    oauthClientSecret: '',
    oauthScope: m.oauthScope ?? '',
    tenantId: tenant,
  };
}

/** Voreinstellungen für Microsoft 365 mit OAuth 2.0 (App-Registrierung in Entra ID). */
function presetM365() {
  if (!draft.value) return;
  Object.assign(draft.value, {
    imapHost: 'outlook.office365.com',
    imapPort: 993,
    imapSecure: true,
    smtpHost: 'smtp.office365.com',
    smtpPort: 587,
    smtpSecurity: 'starttls',
    authType: 'oauth2',
    oauthScope: 'https://outlook.office365.com/.default',
    username: draft.value.username || draft.value.address,
  });
  applyTenant();
}

function applyTenant() {
  if (draft.value?.tenantId.trim()) {
    draft.value.oauthTokenUrl = `https://login.microsoftonline.com/${draft.value.tenantId.trim()}/oauth2/v2.0/token`;
  }
}

async function save() {
  const d = draft.value;
  if (!d) return;
  saving.value = true;
  error.value = '';
  const body: Record<string, unknown> = {
    name: d.name,
    address: d.address,
    active: d.active,
    isDefault: d.isDefault,
    imapHost: d.imapHost,
    imapPort: d.imapPort,
    imapSecure: d.imapSecure,
    imapFolder: d.imapFolder,
    smtpHost: d.smtpHost,
    smtpPort: d.smtpPort,
    smtpSecurity: d.smtpSecurity,
    authType: d.authType,
    username: d.username,
    oauthTokenUrl: d.oauthTokenUrl || null,
    oauthClientId: d.oauthClientId || null,
    oauthScope: d.oauthScope || null,
  };
  if (d.password) body.password = d.password;
  if (d.oauthClientSecret) body.oauthClientSecret = d.oauthClientSecret;
  try {
    if (d.id) await api.put(`/admin/mailboxes/${d.id}`, body);
    else await api.post('/admin/mailboxes', body);
    draft.value = null;
    toast.success('Postfach gespeichert');
    await Promise.all([load(), session.loadMailboxes()]);
  } catch (err) {
    error.value = errorMessage(err);
  } finally {
    saving.value = false;
  }
}

async function test(m: Mailbox) {
  busyId.value = m.id;
  try {
    testResult.value[m.id] = await api.post(`/admin/mailboxes/${m.id}/test`);
  } catch (err) {
    toast.error(err);
  } finally {
    busyId.value = null;
  }
}

async function poll(m: Mailbox) {
  busyId.value = m.id;
  try {
    await api.post(`/admin/mailboxes/${m.id}/poll`);
    await Promise.all([load(), session.refreshCounts()]);
    toast.success('Abruf ausgeführt');
  } catch (err) {
    toast.error(err);
  } finally {
    busyId.value = null;
  }
}

async function remove(m: Mailbox) {
  if (!confirm(`Postfach «${m.name}» löschen? Bestehende Vorgänge bleiben erhalten und antworten künftig über das Standard-Postfach.`)) return;
  try {
    await api.delete(`/admin/mailboxes/${m.id}`);
    await Promise.all([load(), session.loadMailboxes()]);
  } catch (err) {
    toast.error(err);
  }
}
</script>

<template>
  <div class="stack">
    <div class="page-head" style="margin: 0">
      <h1>Postfächer</h1>
      <div class="spacer" />
      <button class="btn btn-primary" type="button" @click="create">+ Postfach</button>
    </div>
    <p class="muted" style="margin: 0">
      Neue Mails werden jede Minute per IMAP abgeholt. Beim ersten Abruf werden nur ungelesene Mails übernommen.
      Antworten gehen über das Postfach, in dem der Vorgang angekommen ist; intern erfasste Vorgänge nutzen das Standard-Postfach.
    </p>

    <div v-if="!mailboxes.length" class="card empty">Noch kein Postfach eingerichtet.</div>
    <div v-for="m in mailboxes" :key="m.id" class="card card-body mailbox">
      <div class="row">
        <h2>{{ m.name }}</h2>
        <span class="muted">{{ m.address }}</span>
        <span v-if="m.isDefault" class="badge cat-new">Standard</span>
        <span v-if="!m.active" class="badge">inaktiv</span>
        <span class="badge">{{ m.authType === 'oauth2' ? 'OAuth 2.0' : 'Passwort' }}</span>
        <div class="spacer" />
        <button class="btn btn-sm" type="button" :disabled="busyId === m.id" @click="test(m)">Verbindung testen</button>
        <button class="btn btn-sm" type="button" :disabled="busyId === m.id || !m.active" @click="poll(m)">Jetzt abrufen</button>
        <button class="btn btn-sm" type="button" @click="edit(m)">Bearbeiten</button>
        <button class="btn btn-sm btn-danger" type="button" @click="remove(m)">Löschen</button>
      </div>
      <div class="muted small">
        IMAP {{ m.imapHost }}:{{ m.imapPort }} ({{ m.imapFolder }}) · SMTP {{ m.smtpHost }}:{{ m.smtpPort }} · Letzter Abruf:
        {{ formatDateTime(m.lastPollAt) }}
      </div>
      <div v-if="m.lastError" class="error-box small">Letzter Fehler: {{ m.lastError }}</div>
      <div v-if="testResult[m.id]" class="small" :class="testResult[m.id]!.ok ? 'ok-box' : 'error-box'">
        IMAP: {{ testResult[m.id]!.imap }}<br />SMTP: {{ testResult[m.id]!.smtp }}
      </div>
    </div>

    <ModalDialog v-if="draft" :title="draft.id ? 'Postfach bearbeiten' : 'Neues Postfach'" wide @close="draft = null">
      <div class="row">
        <span class="muted">Vorlage:</span>
        <button class="btn btn-sm" type="button" @click="presetM365">Microsoft 365 (OAuth 2.0)</button>
      </div>
      <div class="grid-2">
        <div class="field">
          <label for="mb-name">Anzeigename</label>
          <input id="mb-name" v-model="draft.name" class="input" placeholder="z.B. IT Helpdesk" />
        </div>
        <div class="field">
          <label for="mb-address">E-Mail-Adresse</label>
          <input id="mb-address" v-model="draft.address" class="input" type="email" placeholder="it@firma.ch" />
        </div>
      </div>
      <div class="row">
        <label class="checkbox"><input v-model="draft.active" type="checkbox" /> Aktiv</label>
        <label class="checkbox"><input v-model="draft.isDefault" type="checkbox" /> Standard-Postfach</label>
      </div>

      <h3>IMAP (Eingang)</h3>
      <div class="grid-3">
        <div class="field">
          <label for="mb-imap-host">Server</label>
          <input id="mb-imap-host" v-model="draft.imapHost" class="input" />
        </div>
        <div class="field">
          <label for="mb-imap-port">Port</label>
          <input id="mb-imap-port" v-model.number="draft.imapPort" class="input" type="number" />
        </div>
        <div class="field">
          <label for="mb-imap-folder">Ordner</label>
          <input id="mb-imap-folder" v-model="draft.imapFolder" class="input" />
        </div>
      </div>
      <label class="checkbox"><input v-model="draft.imapSecure" type="checkbox" /> TLS-Verbindung (üblich bei Port 993)</label>

      <h3>SMTP (Ausgang)</h3>
      <div class="grid-3">
        <div class="field">
          <label for="mb-smtp-host">Server</label>
          <input id="mb-smtp-host" v-model="draft.smtpHost" class="input" />
        </div>
        <div class="field">
          <label for="mb-smtp-port">Port</label>
          <input id="mb-smtp-port" v-model.number="draft.smtpPort" class="input" type="number" />
        </div>
        <div class="field">
          <label for="mb-smtp-sec">Verschlüsselung</label>
          <select id="mb-smtp-sec" v-model="draft.smtpSecurity" class="select">
            <option value="starttls">STARTTLS (Port 587)</option>
            <option value="tls">TLS (Port 465)</option>
            <option value="none">keine</option>
          </select>
        </div>
      </div>

      <h3>Anmeldung</h3>
      <div class="grid-2">
        <div class="field">
          <label for="mb-auth">Verfahren</label>
          <select id="mb-auth" v-model="draft.authType" class="select">
            <option value="password">Benutzername und Passwort</option>
            <option value="oauth2">OAuth 2.0 (Modern Auth)</option>
          </select>
        </div>
        <div class="field">
          <label for="mb-user">Benutzername</label>
          <input id="mb-user" v-model="draft.username" class="input" autocomplete="off" />
        </div>
      </div>
      <div v-if="draft.authType === 'password'" class="field">
        <label for="mb-pass">Passwort</label>
        <input
          id="mb-pass"
          v-model="draft.password"
          class="input"
          type="password"
          autocomplete="new-password"
          :placeholder="draft.hasPassword ? 'gespeichert – leer lassen, um es zu behalten' : ''"
        />
      </div>
      <template v-else>
        <div class="grid-2">
          <div class="field">
            <label for="mb-tenant">Tenant-ID (Microsoft 365)</label>
            <input id="mb-tenant" v-model="draft.tenantId" class="input" @change="applyTenant" />
            <span class="hint">Füllt die Token-URL automatisch.</span>
          </div>
          <div class="field">
            <label for="mb-client">Client-ID (Anwendungs-ID)</label>
            <input id="mb-client" v-model="draft.oauthClientId" class="input" />
          </div>
        </div>
        <div class="field">
          <label for="mb-token">Token-URL</label>
          <input id="mb-token" v-model="draft.oauthTokenUrl" class="input" />
        </div>
        <div class="grid-2">
          <div class="field">
            <label for="mb-secret">Client-Secret</label>
            <input
              id="mb-secret"
              v-model="draft.oauthClientSecret"
              class="input"
              type="password"
              autocomplete="new-password"
              :placeholder="draft.hasClientSecret ? 'gespeichert – leer lassen, um es zu behalten' : ''"
            />
          </div>
          <div class="field">
            <label for="mb-scope">Scope</label>
            <input id="mb-scope" v-model="draft.oauthScope" class="input" placeholder="https://outlook.office365.com/.default" />
          </div>
        </div>
        <span class="hint faint">
          Microsoft 365 braucht eine App-Registrierung mit IMAP.AccessAsApp und SMTP.SendAsApp, einen Service Principal in Exchange Online mit
          Zugriff auf das Postfach und aktiviertes SMTP AUTH auf dem Postfach.
        </span>
      </template>
      <div v-if="error" class="error-box">{{ error }}</div>
      <template #footer>
        <button class="btn" type="button" @click="draft = null">Abbrechen</button>
        <button class="btn btn-primary" type="button" :disabled="saving" @click="save">Speichern</button>
      </template>
    </ModalDialog>
  </div>
</template>

<style scoped>
.mailbox {
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.small {
  font-size: 12px;
}
.grid-3 {
  display: grid;
  grid-template-columns: 2fr 1fr 1fr;
  gap: 12px;
}
.ok-box {
  padding: 10px 12px;
  border-radius: var(--radius-sm);
  background: var(--success-soft);
  color: var(--success);
}
h3 {
  margin-top: 6px;
}
</style>
