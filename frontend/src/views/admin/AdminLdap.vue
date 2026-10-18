<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue';
import { api, errorMessage } from '../../api';
import { formatDate } from '../../format';
import { useToast } from '../../stores/toast';
import type { LdapCheck, LdapSettings } from '../../types';

const toast = useToast();
const form = ref<LdapSettings | null>(null);
/** Stand beim Laden bzw. Speichern, um zu erkennen, ob das gespeicherte Passwort noch gilt. */
const saved = ref<{
  url: string;
  bindDn: string;
  hasBindPassword: boolean;
  caCertificate: string;
  enabled: boolean;
  snapshot: string;
} | null>(null);
const bindPassword = ref('');
const testUser = ref('');
const testPassword = ref('');
const checks = ref<LdapCheck[] | null>(null);
const testing = ref(false);
const saving = ref(false);
const error = ref('');
const caFileInput = ref<HTMLInputElement | null>(null);

/** Vergleichbarer Stand der bearbeitbaren Felder, um ungespeicherte Änderungen zu erkennen. */
function snapshotOf(settings: LdapSettings): string {
  const { hasBindPassword: _h, caInfo: _c, ...editable } = settings;
  return JSON.stringify(editable);
}

function remember(settings: LdapSettings) {
  form.value = settings;
  saved.value = {
    url: settings.url,
    bindDn: settings.bindDn,
    hasBindPassword: settings.hasBindPassword,
    caCertificate: settings.caCertificate,
    enabled: settings.enabled,
    snapshot: snapshotOf(settings),
  };
}

const dirty = computed(
  () => !!form.value && !!saved.value && (snapshotOf(form.value) !== saved.value.snapshot || !!bindPassword.value),
);

onMounted(async () => {
  try {
    remember(await api.get<LdapSettings>('/settings/ldap'));
  } catch (err) {
    toast.error(err);
  }
});

const isLdaps = computed(() => !!form.value?.url.trim().toLowerCase().startsWith('ldaps:'));
watch(isLdaps, (ldaps) => {
  if (ldaps && form.value) form.value.startTls = false;
});

/** Gespeichertes Passwort gilt nur für dieselbe Server-URL und denselben Bind-DN. */
const passwordReusable = computed(() => {
  if (!form.value || !saved.value?.hasBindPassword) return false;
  const same = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();
  return same(form.value.url, saved.value.url) && same(form.value.bindDn, saved.value.bindDn);
});
const passwordPlaceholder = computed(() => {
  if (passwordReusable.value) return 'gespeichert – leer lassen, um es zu behalten';
  if (saved.value?.hasBindPassword) return 'bitte neu eingeben (Server oder Dienstkonto geändert)';
  return '';
});

const caChanged = computed(() => !!form.value && form.value.caCertificate.trim() !== (saved.value?.caCertificate ?? '').trim());

function applyPreset(kind: 'ad' | 'openldap') {
  if (!form.value) return;
  if (kind === 'ad') {
    Object.assign(form.value, {
      userFilter:
        '(&(objectClass=user)(objectCategory=person)(|(sAMAccountName={{username}})(userPrincipalName={{username}})(mail={{username}})))',
      nameAttribute: 'displayName',
      mailAttribute: 'mail',
      nestedGroups: true,
      startTls: !isLdaps.value,
    });
    toast.success('Vorlage «Active Directory» übernommen. Server, Dienstkonto, Basis-DN und Gruppen bitte selbst eintragen.');
  } else {
    Object.assign(form.value, {
      userFilter: '(&(objectClass=inetOrgPerson)(|(uid={{username}})(mail={{username}})))',
      nameAttribute: 'displayName',
      mailAttribute: 'mail',
      nestedGroups: false,
    });
    toast.success('Vorlage «OpenLDAP» übernommen.');
  }
}

/** Liest ein Zertifikat als PEM oder DER (.cer) und wandelt es in PEM um. */
async function loadCaFile(e: Event) {
  const file = (e.target as HTMLInputElement).files?.[0];
  if (!file || !form.value) return;
  const bytes = new Uint8Array(await file.arrayBuffer());
  const text = new TextDecoder('utf-8', { fatal: false }).decode(bytes);
  if (text.includes('-----BEGIN CERTIFICATE-----')) {
    form.value.caCertificate = text.trim();
  } else {
    let binary = '';
    for (const b of bytes) binary += String.fromCharCode(b);
    const base64 = btoa(binary).replace(/(.{64})/g, '$1\n').trim();
    form.value.caCertificate = `-----BEGIN CERTIFICATE-----\n${base64}\n-----END CERTIFICATE-----`;
  }
  if (caFileInput.value) caFileInput.value.value = '';
}

function payload() {
  const { hasBindPassword: _h, caInfo: _c, ...rest } = form.value!;
  return { ...rest, ...(bindPassword.value ? { bindPassword: bindPassword.value } : {}) };
}

async function save() {
  saving.value = true;
  error.value = '';
  try {
    remember(await api.put<LdapSettings>('/settings/ldap', payload()));
    bindPassword.value = '';
    toast.success('Gespeichert');
  } catch (err) {
    error.value = errorMessage(err);
  } finally {
    saving.value = false;
  }
}

async function test() {
  testing.value = true;
  checks.value = null;
  try {
    const result = await api.post<{ checks: LdapCheck[] }>('/settings/ldap/test', {
      ...payload(),
      username: testUser.value || undefined,
      password: testPassword.value || undefined,
    });
    checks.value = result.checks;
  } catch (err) {
    checks.value = [{ key: 'error', label: 'Test', status: 'error', message: errorMessage(err) }];
  } finally {
    testing.value = false;
    testPassword.value = '';
  }
}

const ICONS: Record<LdapCheck['status'], string> = { ok: '✓', warning: '!', error: '✕', skipped: '–' };

const groupName = (dn: string) => dn.match(/^CN=((?:\\,|[^,])+)/i)?.[1]?.replace(/\\,/g, ',') ?? dn;
const sameDn = (a: string, b: string) =>
  a.replace(/\s*,\s*/g, ',').trim().toLowerCase() === b.replace(/\s*,\s*/g, ',').trim().toLowerCase();

/** Übernimmt eine Gruppe des Testbenutzers als Admin- oder IT-Gruppe ins Formular. */
function useGroup(role: 'admin' | 'it', dn: string) {
  if (!form.value) return;
  if (role === 'admin') form.value.adminGroupDn = dn;
  else form.value.itGroupDn = dn;
  toast.success(`«${groupName(dn)}» als ${role === 'admin' ? 'Admin' : 'IT'}-Gruppe übernommen. Bitte speichern und erneut testen.`);
}
</script>

<template>
  <div v-if="form" class="stack">
    <h1>LDAP / Active Directory</h1>
    <div v-if="saved && !saved.enabled" class="warn-box">
      <strong>Die LDAP-Anmeldung ist ausgeschaltet.</strong> AD-Benutzer können sich erst anmelden, wenn «LDAP-Anmeldung
      aktivieren» gesetzt und gespeichert ist. Der Test unten funktioniert auch ohne.
    </div>
    <p class="muted" style="margin: 0">
      Benutzer aus dem Verzeichnis werden bei der ersten Anmeldung angelegt. Die Rolle ergibt sich bei jeder Anmeldung aus der
      Gruppenmitgliedschaft: Admin-Gruppe → Admin, IT-Gruppe → IT, alle anderen → Standard (ohne Anmeldung).
    </p>

    <div class="card card-body stack">
      <div class="row wrap">
        <label class="checkbox"><input v-model="form.enabled" type="checkbox" /> LDAP-Anmeldung aktivieren</label>
        <div class="spacer" />
        <span class="muted">Vorlage:</span>
        <button class="btn btn-sm" type="button" @click="applyPreset('ad')">Active Directory</button>
        <button class="btn btn-sm" type="button" @click="applyPreset('openldap')">OpenLDAP</button>
      </div>

      <fieldset class="section">
        <legend>Server</legend>
        <div class="field">
          <label for="ldap-url">Server-URL</label>
          <input id="ldap-url" v-model="form.url" class="input" placeholder="ldap://dc01.firma.local" />
          <span class="hint">
            Den vollständigen Servernamen verwenden, auf den das Zertifikat ausgestellt ist (z.B. dc01.firma.local).
          </span>
        </div>
        <div class="row wrap">
          <label class="checkbox" :class="{ disabled: isLdaps }">
            <input v-model="form.startTls" type="checkbox" :disabled="isLdaps" /> STARTTLS (Verbindung auf Port 389 verschlüsseln)
          </label>
          <label class="checkbox"><input v-model="form.rejectUnauthorized" type="checkbox" /> Zertifikat prüfen</label>
        </div>
        <p class="hint-box">
          Active Directory nimmt Anmeldungen über unverschlüsseltes LDAP oft nicht an (LDAP-Signierung, Standard ab Windows Server
          2025). Dann STARTTLS aktivieren. Der Domain Controller braucht dafür ein Zertifikat.
        </p>
        <div class="field">
          <div class="row">
            <label for="ldap-ca" class="label">CA-Zertifikat (optional)</label>
            <div class="spacer" />
            <button class="btn btn-sm" type="button" @click="caFileInput?.click()">Datei laden …</button>
            <button v-if="form.caCertificate" class="btn btn-sm btn-ghost btn-danger" type="button" @click="form.caCertificate = ''">
              Entfernen
            </button>
            <input ref="caFileInput" type="file" accept=".cer,.crt,.pem,.der" hidden @change="loadCaFile" />
          </div>
          <textarea
            id="ldap-ca"
            v-model="form.caCertificate"
            class="textarea mono ca"
            rows="4"
            placeholder="-----BEGIN CERTIFICATE-----&#10;…&#10;-----END CERTIFICATE-----"
            spellcheck="false"
          />
          <span class="hint">
            Nur nötig, wenn das Zertifikat des Servers von einer internen Zertifizierungsstelle stammt: das Zertifikat der
            Stammzertifizierungsstelle (.cer, Base64 oder DER) einfügen bzw. laden.
          </span>
          <span v-if="form.caInfo && !caChanged" class="ca-info">
            Gespeichert: «{{ form.caInfo.subject }}», ausgestellt von «{{ form.caInfo.issuer }}», gültig bis {{ formatDate(form.caInfo.validTo) }}
          </span>
        </div>
      </fieldset>

      <fieldset class="section">
        <legend>Dienstkonto</legend>
        <div class="grid-2">
          <div class="field">
            <label for="ldap-bind">Bind-DN bzw. Benutzer</label>
            <input id="ldap-bind" v-model="form.bindDn" class="input" placeholder="svc-patchwork@firma.local" />
            <span class="hint">Active Directory: benutzer@domäne, DOMÄNE\benutzer oder CN=…,OU=…,DC=…</span>
          </div>
          <div class="field">
            <label for="ldap-bindpw">Passwort</label>
            <input
              id="ldap-bindpw"
              v-model="bindPassword"
              class="input"
              type="password"
              autocomplete="new-password"
              :placeholder="passwordPlaceholder"
            />
          </div>
        </div>
      </fieldset>

      <fieldset class="section">
        <legend>Benutzersuche</legend>
        <div class="field">
          <label for="ldap-base">Basis-DN</label>
          <input id="ldap-base" v-model="form.baseDn" class="input" placeholder="DC=firma,DC=local" />
        </div>
        <div class="field">
          <label for="ldap-filter">Benutzerfilter</label>
          <input id="ldap-filter" v-model="form.userFilter" class="input mono" />
          <span class="hint"><code v-pre>{{username}}</code> wird durch den eingegebenen Benutzernamen ersetzt.</span>
        </div>
        <div class="grid-2">
          <div class="field">
            <label for="ldap-name">Attribut für den Namen</label>
            <input id="ldap-name" v-model="form.nameAttribute" class="input" />
          </div>
          <div class="field">
            <label for="ldap-mail">Attribut für die E-Mail</label>
            <input id="ldap-mail" v-model="form.mailAttribute" class="input" />
          </div>
        </div>
      </fieldset>

      <fieldset class="section">
        <legend>Rollen</legend>
        <div class="grid-2">
          <div class="field">
            <label for="ldap-admin">Gruppe für Admin (DN)</label>
            <input id="ldap-admin" v-model="form.adminGroupDn" class="input" placeholder="CN=Patchwork-Admin,OU=Gruppen,DC=firma,DC=local" />
          </div>
          <div class="field">
            <label for="ldap-it">Gruppe für IT (DN)</label>
            <input id="ldap-it" v-model="form.itGroupDn" class="input" placeholder="CN=Patchwork-IT,OU=Gruppen,DC=firma,DC=local" />
          </div>
        </div>
        <label class="checkbox">
          <input v-model="form.nestedGroups" type="checkbox" /> Verschachtelte Gruppen auflösen (nur Active Directory)
        </label>
      </fieldset>

      <div v-if="error" class="error-box">{{ error }}</div>
      <div class="row">
        <button class="btn btn-primary" type="button" :disabled="saving" @click="save">Speichern</button>
        <span v-if="dirty" class="dirty">Ungespeicherte Änderungen</span>
      </div>
    </div>

    <div class="card card-body stack">
      <h2>Einstellungen testen</h2>
      <p class="muted" style="margin: 0">
        Prüft die Angaben oben Schritt für Schritt, auch wenn sie noch nicht gespeichert sind. Optional mit einem Testbenutzer, um Suche,
        Rolle und Anmeldung zu prüfen.
      </p>
      <div class="row wrap">
        <input v-model="testUser" class="input test-input" placeholder="Testbenutzer (optional)" autocomplete="off" />
        <input
          v-model="testPassword"
          class="input test-input"
          type="password"
          placeholder="Passwort des Testbenutzers (optional)"
          autocomplete="new-password"
          :disabled="!testUser"
        />
        <button class="btn" type="button" :disabled="testing" @click="test">{{ testing ? 'Teste …' : 'Testen' }}</button>
      </div>
      <ol v-if="checks" class="checks">
        <li v-for="c in checks" :key="c.key" class="check" :class="c.status">
          <span class="icon" aria-hidden="true">{{ ICONS[c.status] }}</span>
          <div class="check-text">
            <div class="check-label">{{ c.label }}</div>
            <div class="check-message">{{ c.message }}</div>
            <details v-if="c.detail" class="check-detail">
              <summary>Antwort des Servers</summary>
              <code>{{ c.detail }}</code>
            </details>
            <div v-if="c.groups" class="groups">
              <div class="groups-title">
                {{ c.groups.length ? 'Gruppen dieses Benutzers – als Rollen-Gruppe übernehmen:' : 'Der Benutzer ist in keiner Gruppe (ausser der primären Gruppe).' }}
              </div>
              <div v-for="g in c.groups" :key="g" class="group-row">
                <div class="group-name">
                  <strong>{{ groupName(g) }}</strong>
                  <code>{{ g }}</code>
                </div>
                <button
                  class="btn btn-sm"
                  :class="{ chosen: sameDn(form.adminGroupDn, g) }"
                  type="button"
                  @click="useGroup('admin', g)"
                >
                  {{ sameDn(form.adminGroupDn, g) ? '✓ Admin' : 'Admin' }}
                </button>
                <button
                  class="btn btn-sm"
                  :class="{ chosen: sameDn(form.itGroupDn, g) }"
                  type="button"
                  @click="useGroup('it', g)"
                >
                  {{ sameDn(form.itGroupDn, g) ? '✓ IT' : 'IT' }}
                </button>
              </div>
            </div>
          </div>
        </li>
      </ol>
    </div>
  </div>
</template>

<style scoped>
.section {
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  padding: 12px;
  margin: 0;
  display: flex;
  flex-direction: column;
  gap: 12px;
  min-width: 0;
}
.section legend {
  padding: 0 6px;
  font-weight: 600;
}
.wrap {
  flex-wrap: wrap;
}
.warn-box {
  padding: 10px 12px;
  border-radius: var(--radius-sm);
  background: var(--warning-soft);
  color: var(--text);
  border-left: 3px solid var(--warning);
}
.dirty {
  font-size: 12px;
  color: var(--warning);
  font-weight: 600;
}
.checkbox.disabled {
  opacity: 0.55;
}
.hint-box {
  margin: 0;
  padding: 8px 10px;
  border-radius: var(--radius-sm);
  background: var(--surface-2);
  color: var(--text-muted);
  font-size: 13px;
}
.ca {
  font-size: 12px;
  min-height: 70px;
}
.ca-info {
  font-size: 12px;
  color: var(--success);
}
.test-input {
  flex: 1;
  min-width: 200px;
}
.checks {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.check {
  display: flex;
  gap: 10px;
  align-items: flex-start;
  padding: 8px 10px;
  border-radius: var(--radius-sm);
  background: var(--surface-2);
}
.icon {
  width: 22px;
  height: 22px;
  border-radius: 50%;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  font-size: 12px;
  font-weight: 700;
  flex-shrink: 0;
  background: var(--border);
  color: var(--text-muted);
}
.check.ok .icon {
  background: var(--success-soft);
  color: var(--success);
}
.check.warning .icon {
  background: var(--warning-soft);
  color: var(--warning);
}
.check.error .icon {
  background: var(--danger-soft);
  color: var(--danger);
}
.check.skipped {
  opacity: 0.6;
}
.check-text {
  min-width: 0;
}
.check-label {
  font-weight: 600;
}
.check-message {
  color: var(--text-muted);
  overflow-wrap: anywhere;
}
.check-detail {
  margin-top: 4px;
  font-size: 12px;
  color: var(--text-faint);
}
.check-detail summary {
  cursor: pointer;
}
.groups {
  margin-top: 8px;
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.groups-title {
  font-size: 12px;
  color: var(--text-muted);
}
.group-row {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 4px 6px;
  border-radius: var(--radius-sm);
  background: var(--surface);
}
.group-name {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
}
.group-name code {
  font-family: var(--mono);
  font-size: 11px;
  color: var(--text-faint);
  overflow-wrap: anywhere;
}
.btn.chosen {
  background: var(--accent-soft);
  border-color: var(--accent);
  color: var(--accent);
}
.check-detail code {
  display: block;
  margin-top: 4px;
  font-family: var(--mono);
  overflow-wrap: anywhere;
  white-space: pre-wrap;
}
</style>
