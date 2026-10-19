<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref } from 'vue';
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

const AUTH_LABELS: Record<Mailbox['authType'], string> = {
  password: 'Passwort',
  microsoft: 'Microsoft 365',
  oauth2: 'App-Zugriff',
};

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
  authType: Mailbox['authType'];
  username: string;
  password: string;
  oauthTokenUrl: string;
  oauthClientId: string;
  oauthClientSecret: string;
  oauthScope: string;
  hasPassword: boolean;
  hasClientSecret: boolean;
  tenantId: string;
  /** Mails abholen ab, als Wert für das Eingabefeld (Ortszeit) */
  fetchFrom: string;
  /** Wert beim Öffnen: nur ein geänderter Zeitpunkt wird gespeichert */
  fetchFromInitial: string;
  microsoftConnected: boolean;
  oauthAccount: string | null;
}
const draft = ref<Draft | null>(null);
const error = ref('');
const saving = ref(false);

/** Zeitpunkt als Wert für <input type="datetime-local"> in Ortszeit */
function toLocalInput(value: string | Date): string {
  const d = new Date(value);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

async function load() {
  try {
    mailboxes.value = await api.get<Mailbox[]>('/admin/mailboxes');
  } catch (err) {
    toast.error(err);
  }
}
onMounted(() => Promise.all([load(), loadMicrosoft()]));

function create() {
  error.value = '';
  const now = toLocalInput(new Date());
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
    fetchFrom: now,
    fetchFromInitial: now,
    microsoftConnected: false,
    oauthAccount: null,
  };
}

function edit(m: Mailbox) {
  error.value = '';
  const tenant = m.oauthTokenUrl?.match(/login\.microsoftonline\.com\/([^/]+)\//)?.[1] ?? '';
  const fetchFrom = toLocalInput(m.fetchFrom);
  draft.value = {
    ...m,
    password: '',
    oauthTokenUrl: m.oauthTokenUrl ?? '',
    oauthClientId: m.oauthClientId ?? '',
    oauthClientSecret: '',
    oauthScope: m.oauthScope ?? '',
    tenantId: tenant,
    fetchFrom,
    fetchFromInitial: fetchFrom,
  };
}

/** Voreinstellungen für Microsoft 365: Server und Anmeldung mit einem Microsoft-Konto. */
function presetM365() {
  if (!draft.value) return;
  Object.assign(draft.value, {
    imapHost: 'outlook.office365.com',
    imapPort: 993,
    imapSecure: true,
    smtpHost: 'smtp.office365.com',
    smtpPort: 587,
    smtpSecurity: 'starttls',
    authType: 'microsoft',
  });
}

function applyTenant() {
  if (draft.value?.tenantId.trim()) {
    draft.value.oauthTokenUrl = `https://login.microsoftonline.com/${draft.value.tenantId.trim()}/oauth2/v2.0/token`;
  }
}

async function save() {
  const d = draft.value;
  if (!d) return;
  if (!d.fetchFrom) {
    error.value = 'Bitte angeben, ab wann Mails abgeholt werden';
    return;
  }
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
    username: d.authType === 'microsoft' ? d.address : d.username,
    oauthTokenUrl: d.oauthTokenUrl || null,
    oauthClientId: d.oauthClientId || null,
    oauthScope: d.oauthScope || null,
  };
  if (d.password) body.password = d.password;
  if (d.oauthClientSecret) body.oauthClientSecret = d.oauthClientSecret;
  if (!d.id || d.fetchFrom !== d.fetchFromInitial) body.fetchFrom = new Date(d.fetchFrom).toISOString();
  try {
    const saved = d.id
      ? await api.put<Mailbox>(`/admin/mailboxes/${d.id}`, body)
      : await api.post<Mailbox>('/admin/mailboxes', body);
    draft.value = null;
    toast.success('Postfach gespeichert');
    await Promise.all([load(), session.loadMailboxes()]);
    // Neues Postfach mit Microsoft-Konto: gleich anmelden
    if (saved.authType === 'microsoft' && !saved.microsoftConnected && microsoftClientId.value) await startMicrosoft(saved);
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

// ---- Microsoft 365: einmalige Einrichtung (App-Registrierung) ----

const microsoftClientId = ref('');
const setupOpen = ref(false);
const clientIdDraft = ref('');
const setupError = ref('');
const savingSetup = ref(false);

async function loadMicrosoft() {
  try {
    microsoftClientId.value = (await api.get<{ clientId: string }>('/settings/microsoft')).clientId;
  } catch (err) {
    toast.error(err);
  }
}

function openSetup() {
  clientIdDraft.value = microsoftClientId.value;
  setupError.value = '';
  setupOpen.value = true;
}

async function saveSetup() {
  savingSetup.value = true;
  setupError.value = '';
  try {
    microsoftClientId.value = (await api.put<{ clientId: string }>('/settings/microsoft', { clientId: clientIdDraft.value })).clientId;
    setupOpen.value = false;
    toast.success(microsoftClientId.value ? 'Microsoft 365 eingerichtet' : 'Anwendungs-ID entfernt');
  } catch (err) {
    setupError.value = errorMessage(err);
  } finally {
    savingSetup.value = false;
  }
}

// ---- Microsoft 365: Anmeldung eines Postfachs mit Code ----

interface Login {
  mailbox: Mailbox;
  userCode: string;
  verificationUri: string;
  expiresIn: number;
  error: string;
}
const login = ref<Login | null>(null);
const copied = ref(false);
let loginTimer: number | undefined;
let popup: Window | null = null;

async function startMicrosoft(m: Mailbox) {
  stopLogin();
  copied.value = false;
  try {
    const started = await api.post<{ userCode: string; verificationUri: string; expiresIn: number; interval: number }>(
      `/admin/mailboxes/${m.id}/microsoft/start`,
    );
    login.value = { mailbox: m, ...started, error: '' };
    loginTimer = window.setInterval(checkMicrosoft, Math.max(started.interval, 3) * 1000);
  } catch (err) {
    login.value = { mailbox: m, userCode: '', verificationUri: '', expiresIn: 0, error: errorMessage(err) };
  }
}

async function checkMicrosoft() {
  const current = login.value;
  if (!current) return stopLogin();
  try {
    const result = await api.post<{ status: 'pending' | 'done' | 'failed'; account?: string; message?: string }>(
      `/admin/mailboxes/${current.mailbox.id}/microsoft/check`,
    );
    if (result.status === 'pending') return;
    stopLogin();
    if (result.status === 'done') {
      popup?.close();
      login.value = null;
      toast.success(`Angemeldet als ${result.account}`);
      await load();
    } else {
      current.error = result.message ?? 'Die Anmeldung ist fehlgeschlagen';
    }
  } catch (err) {
    stopLogin();
    current.error = errorMessage(err);
  }
}

function stopLogin() {
  window.clearInterval(loginTimer);
  loginTimer = undefined;
}

function closeLogin() {
  stopLogin();
  login.value = null;
}
onBeforeUnmount(stopLogin);

/** Code kopieren und die Anmeldeseite von Microsoft in einem Popup öffnen. */
function openMicrosoft() {
  if (!login.value) return;
  copied.value = copyText(login.value.userCode);
  popup = window.open(login.value.verificationUri, 'patchwork-microsoft', 'popup,width=520,height=720');
}

/** Ohne HTTPS gibt es die Zwischenablage-API nicht, dann über ein unsichtbares Feld kopieren. */
function copyText(text: string): boolean {
  if (navigator.clipboard && window.isSecureContext) {
    navigator.clipboard.writeText(text).catch(() => undefined);
    return true;
  }
  const field = document.createElement('textarea');
  field.value = text;
  field.style.position = 'fixed';
  field.style.opacity = '0';
  document.body.appendChild(field);
  field.select();
  const ok = document.execCommand('copy');
  field.remove();
  return ok;
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
      Neue Mails werden jede Minute per IMAP abgeholt, ab dem beim Postfach eingestellten Zeitpunkt.
      Patchwork verändert das Postfach nicht: Mails bleiben ungelesen und werden weder verschoben noch gelöscht.
      Antworten gehen über das Postfach, in dem der Vorgang angekommen ist; intern erfasste Vorgänge nutzen das Standard-Postfach.
    </p>

    <div class="card card-body row microsoft">
      <h2>Microsoft 365</h2>
      <span v-if="microsoftClientId" class="badge cat-done">eingerichtet</span>
      <span v-else class="badge">noch nicht eingerichtet</span>
      <span class="muted small">
        Postfächer in Microsoft 365 meldet man mit einem Microsoft-Konto an. Dafür braucht es einmalig eine App-Registrierung.
      </span>
      <div class="spacer" />
      <button class="btn btn-sm" :class="{ 'btn-primary': !microsoftClientId }" type="button" @click="openSetup">
        {{ microsoftClientId ? 'Einrichtung ansehen' : 'Einrichten' }}
      </button>
    </div>

    <div v-if="!mailboxes.length" class="card empty">Noch kein Postfach eingerichtet.</div>
    <div v-for="m in mailboxes" :key="m.id" class="card card-body mailbox">
      <div class="row">
        <h2>{{ m.name }}</h2>
        <span class="muted">{{ m.address }}</span>
        <span v-if="m.isDefault" class="badge cat-new">Standard</span>
        <span v-if="!m.active" class="badge">inaktiv</span>
        <span class="badge">{{ AUTH_LABELS[m.authType] }}</span>
        <div class="spacer" />
        <button
          v-if="m.authType === 'microsoft'"
          class="btn btn-sm"
          :class="{ 'btn-primary': !m.microsoftConnected }"
          type="button"
          @click="startMicrosoft(m)"
        >
          {{ m.microsoftConnected ? 'Neu anmelden' : 'Mit Microsoft anmelden' }}
        </button>
        <button class="btn btn-sm" type="button" :disabled="busyId === m.id" @click="test(m)">Verbindung testen</button>
        <button class="btn btn-sm" type="button" :disabled="busyId === m.id || !m.active" @click="poll(m)">Jetzt abrufen</button>
        <button class="btn btn-sm" type="button" @click="edit(m)">Bearbeiten</button>
        <button class="btn btn-sm btn-danger" type="button" @click="remove(m)">Löschen</button>
      </div>
      <div class="muted small">
        IMAP {{ m.imapHost }}:{{ m.imapPort }} ({{ m.imapFolder }}) · SMTP {{ m.smtpHost }}:{{ m.smtpPort }} · Mails ab
        {{ formatDateTime(m.fetchFrom) }} · Letzter Abruf: {{ formatDateTime(m.lastPollAt) }}
      </div>
      <div v-if="m.authType === 'microsoft'" class="small" :class="m.microsoftConnected ? 'muted' : 'warning-text'">
        {{ m.microsoftConnected ? `Angemeldet als ${m.oauthAccount}` : 'Noch nicht mit Microsoft angemeldet' }}
      </div>
      <div v-if="m.lastError" class="error-box small">Letzter Fehler: {{ m.lastError }}</div>
      <div v-if="testResult[m.id]" class="small" :class="testResult[m.id]!.ok ? 'ok-box' : 'error-box'">
        IMAP: {{ testResult[m.id]!.imap }}<br />SMTP: {{ testResult[m.id]!.smtp }}
      </div>
    </div>

    <ModalDialog v-if="draft" :title="draft.id ? 'Postfach bearbeiten' : 'Neues Postfach'" wide @close="draft = null">
      <div class="row">
        <span class="muted">Vorlage:</span>
        <button class="btn btn-sm" type="button" @click="presetM365">Microsoft 365</button>
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
      <div class="field">
        <label for="mb-fetch-from">Mails abholen ab</label>
        <input id="mb-fetch-from" v-model="draft.fetchFrom" class="input fetch-from" type="datetime-local" />
        <span class="hint">
          Patchwork übernimmt alle Mails, die ab diesem Zeitpunkt im Postfach eingegangen sind, gelesen oder nicht. Wird der
          Zeitpunkt geändert, holt Patchwork ab dem neuen Zeitpunkt nach, was noch fehlt – ohne doppelte Vorgänge.
        </span>
      </div>

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
            <option value="microsoft">Microsoft 365: Anmeldung mit Microsoft-Konto</option>
            <option value="oauth2">Erweitert: App-Zugriff mit Client Secret</option>
          </select>
        </div>
        <div v-if="draft.authType !== 'microsoft'" class="field">
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
      <template v-else-if="draft.authType === 'microsoft'">
        <div v-if="!microsoftClientId" class="error-box">
          Microsoft 365 ist noch nicht eingerichtet.
          <button class="btn btn-sm" type="button" @click="openSetup">Einrichten</button>
        </div>
        <span v-else-if="draft.microsoftConnected" class="hint">
          Angemeldet als {{ draft.oauthAccount }}. Neu anmelden geht über «Neu anmelden» beim Postfach.
        </span>
        <span v-else class="hint">
          Nach dem Speichern meldest du das Postfach mit einem Microsoft-Konto an: mit dem Konto des Postfachs selbst oder mit einem
          Konto, das Vollzugriff darauf hat (bei einem freigegebenen Postfach zusätzlich «Senden als»).
        </span>
      </template>
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
          App-Zugriff ohne angemeldetes Konto, z.B. wenn die Anmeldung mit Code gesperrt ist. Braucht eine eigene App-Registrierung
          mit IMAP.AccessAsApp und SMTP.SendAsApp, einen Service Principal in Exchange Online mit Zugriff auf das Postfach und
          aktiviertes SMTP AUTH auf dem Postfach.
        </span>
      </template>
      <div v-if="error" class="error-box">{{ error }}</div>
      <template #footer>
        <button class="btn" type="button" @click="draft = null">Abbrechen</button>
        <button class="btn btn-primary" type="button" :disabled="saving" @click="save">Speichern</button>
      </template>
    </ModalDialog>

    <ModalDialog v-if="login" title="Mit Microsoft anmelden" @close="closeLogin">
      <template v-if="login.userCode">
        <p class="intro">
          Melde dich mit einem Konto an, das Zugriff auf <strong>{{ login.mailbox.address }}</strong> hat: dem Konto des Postfachs
          selbst oder einem Konto mit Vollzugriff (bei einem freigegebenen Postfach zusätzlich «Senden als»).
        </p>
        <div class="code mono">{{ login.userCode }}</div>
        <button v-if="!login.error" class="btn btn-primary" type="button" @click="openMicrosoft">
          Code kopieren und Anmeldeseite öffnen
        </button>
        <p v-if="!login.error" class="faint small">
          <template v-if="copied">Der Code ist kopiert. </template>Auf der Anmeldeseite von Microsoft ({{ login.verificationUri }})
          den Code einfügen, anmelden und bestätigen. Danach schliesst sich das Fenster von selbst. Der Code gilt
          {{ Math.round(login.expiresIn / 60) }} Minuten.
        </p>
        <p v-if="!login.error" class="muted small">Warte auf die Anmeldung …</p>
      </template>
      <div v-if="login.error" class="error-box">{{ login.error }}</div>
      <template #footer>
        <button class="btn" type="button" @click="closeLogin">{{ login.error ? 'Schliessen' : 'Abbrechen' }}</button>
        <button v-if="login.error" class="btn btn-primary" type="button" @click="startMicrosoft(login.mailbox)">Neu starten</button>
      </template>
    </ModalDialog>

    <ModalDialog v-if="setupOpen" title="Microsoft 365 einrichten" wide @close="setupOpen = false">
      <p class="intro">
        Einmalig für die ganze Instanz, etwa 5 Minuten. Dafür braucht es ein Konto mit Admin-Rechten in Microsoft Entra ID (z.B.
        Anwendungsadministrator). Danach meldet man jedes Postfach nur noch mit «Mit Microsoft anmelden» an – ohne Tenant-ID und
        ohne Client Secret.
      </p>
      <ol class="steps">
        <li>
          Im Microsoft Entra Admin Center die
          <a href="https://entra.microsoft.com/#view/Microsoft_AAD_RegisteredApps/ApplicationsListBlade" target="_blank" rel="noopener">
            App-Registrierungen
          </a>
          öffnen und <strong>Neue Registrierung</strong> (New registration) wählen.
        </li>
        <li>
          Name: <code>Patchwork</code>. Unterstützte Kontotypen: <strong>Nur Konten in diesem Organisationsverzeichnis</strong>
          (Single tenant). Umleitungs-URI leer lassen und <strong>Registrieren</strong>.
        </li>
        <li>
          Unter <strong>Authentifizierung</strong> (Authentication) die Einstellung <strong>Öffentliche Clientflows zulassen</strong>
          (Allow public client flows) auf <strong>Ja</strong> setzen und speichern.
        </li>
        <li>
          Unter <strong>API-Berechtigungen</strong> (API permissions) → <strong>Berechtigung hinzufügen</strong>:
          <ul>
            <li>
              <strong>Von meiner Organisation verwendete APIs</strong> → <strong>Office 365 Exchange Online</strong> →
              <strong>Delegierte Berechtigungen</strong>: <code>IMAP.AccessAsUser.All</code> und <code>SMTP.Send</code>
            </li>
            <li>
              <strong>Microsoft Graph</strong> → <strong>Delegierte Berechtigungen</strong>: <code>offline_access</code>,
              <code>openid</code> und <code>profile</code>
            </li>
          </ul>
          Danach <strong>Administratorzustimmung für … erteilen</strong> (Grant admin consent).
        </li>
        <li>Unter <strong>Übersicht</strong> (Overview) die <strong>Anwendungs-ID (Client)</strong> kopieren und hier einfügen:</li>
      </ol>
      <div class="field">
        <label for="ms-client-id">Anwendungs-ID (Client)</label>
        <input
          id="ms-client-id"
          v-model="clientIdDraft"
          class="input mono"
          placeholder="00000000-0000-0000-0000-000000000000"
          autocomplete="off"
        />
      </div>
      <span class="hint faint">
        Im Postfach müssen IMAP und – für den Versand – «Authentifiziertes SMTP» erlaubt sein (Microsoft 365 Admin Center → Benutzer →
        Postfach → E-Mail-Apps verwalten). Im Testbetrieb wird nichts versendet.
      </span>
      <div v-if="setupError" class="error-box">{{ setupError }}</div>
      <template #footer>
        <button class="btn" type="button" @click="setupOpen = false">Abbrechen</button>
        <button class="btn btn-primary" type="button" :disabled="savingSetup" @click="saveSetup">Speichern</button>
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
.microsoft {
  flex-wrap: wrap;
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
.warning-text {
  color: var(--warning);
}
.fetch-from {
  max-width: 240px;
}
h3 {
  margin-top: 6px;
}
.intro {
  margin: 0;
}
.code {
  align-self: flex-start;
  padding: 10px 16px;
  border: 1px dashed var(--border-strong);
  border-radius: var(--radius-sm);
  font-size: 24px;
  letter-spacing: 3px;
  user-select: all;
}
.steps {
  margin: 0;
  padding-left: 20px;
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.steps ul {
  margin: 4px 0;
  padding-left: 18px;
}
.steps code {
  font-family: var(--mono);
  font-size: 12px;
  background: var(--surface-2);
  padding: 1px 4px;
  border-radius: 4px;
}
</style>
