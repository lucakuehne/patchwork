<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { api, errorMessage } from '../../api';
import { copyText } from '../../clipboard';
import { formatDate, formatDateTime } from '../../format';
import { useSession } from '../../stores/session';
import { useToast } from '../../stores/toast';
import type { TlsStatus } from '../../types';

const session = useSession();
const toast = useToast();
const status = ref<TlsStatus | null>(null);
const names = ref('');
const busy = ref(false);
const copied = ref(false);
const uploadError = ref('');
const fileInput = ref<HTMLInputElement | null>(null);

async function load() {
  try {
    status.value = await api.get<TlsStatus>('/admin/tls');
    if (!names.value) names.value = status.value.suggestedNames.join(', ');
  } catch (err) {
    toast.error(err);
  }
}
onMounted(load);

const publicHost = computed(() => {
  try {
    return new URL(status.value?.publicUrl ?? '').hostname;
  } catch {
    return '';
  }
});
const httpsUrl = computed(() =>
  status.value?.publicUrl.startsWith('https://') ? status.value.publicUrl : `https://${publicHost.value}`,
);
/** Fehlt der Name aus PUBLIC_URL im Zertifikat, warnen Browser */
const nameMissing = computed(
  () => !!status.value?.certificate && !!publicHost.value && !status.value.certificate.names.includes(publicHost.value),
);

async function createRequest() {
  const list = names.value
    .split(/[\s,;]+/)
    .map((n) => n.trim())
    .filter(Boolean);
  busy.value = true;
  try {
    status.value = await api.post<TlsStatus>('/admin/tls/request', { names: list });
    copied.value = false;
    toast.success('Anforderung erstellt');
  } catch (err) {
    toast.error(err);
  } finally {
    busy.value = false;
  }
}

async function discard() {
  busy.value = true;
  try {
    status.value = await api.delete<TlsStatus>('/admin/tls/request');
  } catch (err) {
    toast.error(err);
  } finally {
    busy.value = false;
  }
}

function copy() {
  if (status.value?.pending) copied.value = copyText(status.value.pending.csr);
}

/** Anforderung als Datei für certreq oder die Webseite der Zertifizierungsstelle. */
function download() {
  const pending = status.value?.pending;
  if (!pending) return;
  const link = document.createElement('a');
  link.href = URL.createObjectURL(new Blob([pending.csr], { type: 'application/pkcs10' }));
  link.download = `${pending.names[0]}.csr`;
  link.click();
  URL.revokeObjectURL(link.href);
}

async function upload(e: Event) {
  const file = (e.target as HTMLInputElement).files?.[0];
  if (!file) return;
  const form = new FormData();
  form.append('file', file, file.name);
  busy.value = true;
  uploadError.value = '';
  try {
    status.value = await api.post<TlsStatus>('/admin/tls/certificate', form);
    await session.loadInfo();
    toast.success('Zertifikat übernommen');
  } catch (err) {
    uploadError.value = errorMessage(err);
  } finally {
    busy.value = false;
    if (fileInput.value) fileInput.value.value = '';
  }
}
</script>

<template>
  <div class="stack">
    <h1>HTTPS</h1>
    <p class="muted intro">
      Patchwork liefert HTTPS selbst aus. Der Schlüssel entsteht in Patchwork und verlässt den Server nicht, die
      Zertifizierungsstelle signiert nur die Anforderung.
    </p>

    <template v-if="status">
      <div class="card card-body stack">
        <h2>Status</h2>
        <div v-if="status.error" class="error-box">{{ status.error }}</div>
        <template v-if="status.active">
          <div class="row">
            <span class="badge cat-done">aktiv</span>
            <span>Patchwork ist über <strong>{{ httpsUrl }}</strong> erreichbar.</span>
          </div>
          <span v-if="status.redirects" class="faint">Aufrufe über http:// leiten auf https:// um.</span>
          <div v-else class="warning-box">
            PUBLIC_URL steht noch auf <code>{{ status.publicUrl }}</code>. Sobald {{ httpsUrl }} im Browser ohne Warnung
            funktioniert, im Stack (Portainer) PUBLIC_URL auf <code>{{ httpsUrl }}</code> umstellen und neu bereitstellen.
            Danach leitet Patchwork http:// auf https:// um, Cookies gehen nur noch verschlüsselt, und die Anmeldung mit
            Microsoft kehrt direkt zu Patchwork zurück.
          </div>
        </template>
        <template v-else>
          <div class="row"><span class="badge">nicht eingerichtet</span></div>
          <ol class="steps">
            <li>Unten eine Zertifikatsanforderung erstellen.</li>
            <li>Sie von der Zertifizierungsstelle signieren lassen (Anleitung dabei).</li>
            <li>Das signierte Zertifikat hochladen. Patchwork startet HTTPS sofort, ohne Neustart.</li>
          </ol>
        </template>
      </div>

      <div v-if="status.certificate" class="card card-body stack">
        <h2>Zertifikat</h2>
        <dl class="facts">
          <dt>Namen</dt>
          <dd>{{ status.certificate.names.join(', ') }}</dd>
          <dt>Ausgestellt von</dt>
          <dd>{{ status.certificate.issuer }}</dd>
          <dt>Gültig</dt>
          <dd>
            {{ formatDate(status.certificate.validFrom) }} bis {{ formatDate(status.certificate.validTo) }}
            <span :class="{ 'expiry-warning': status.certificate.daysLeft <= 30 }">
              ({{
                status.certificate.daysLeft < 0
                  ? 'abgelaufen'
                  : `noch ${status.certificate.daysLeft} ${status.certificate.daysLeft === 1 ? 'Tag' : 'Tage'}`
              }})
            </span>
          </dd>
        </dl>
        <div v-if="nameMissing" class="warning-box">
          Das Zertifikat enthält den Namen <strong>{{ publicHost }}</strong> aus PUBLIC_URL nicht. Browser zeigen dann eine
          Warnung.
        </div>
        <span class="hint faint">
          Ab 30 Tagen vor Ablauf sehen Admins oben einen Hinweis. Zum Erneuern unten eine neue Anforderung erstellen; das
          aktuelle Zertifikat bleibt aktiv, bis das neue hochgeladen ist.
        </span>
      </div>

      <div class="card card-body stack">
        <h2>{{ status.certificate ? 'Neues Zertifikat anfordern' : 'Zertifikat anfordern' }}</h2>
        <template v-if="status.pending">
          <p class="intro">
            Offene Anforderung vom {{ formatDateTime(status.pending.createdAt) }} für
            <strong>{{ status.pending.names.join(', ') }}</strong>:
          </p>
          <textarea class="textarea mono csr" readonly rows="8" :value="status.pending.csr" />
          <div class="row">
            <button class="btn" type="button" @click="copy">{{ copied ? 'Kopiert' : 'Kopieren' }}</button>
            <button class="btn" type="button" @click="download">Als Datei speichern</button>
            <div class="spacer" />
            <button class="btn btn-danger" type="button" :disabled="busy" @click="discard">Verwerfen</button>
          </div>
          <h3>Signieren mit der Zertifizierungsstelle von Active Directory (AD CS)</h3>
          <ol class="steps">
            <li>Die Anforderung als Datei speichern, z.B. als <code>patchwork.csr</code>.</li>
            <li>
              Auf einem Windows-Rechner in der Domäne:
              <code>certreq -submit -attrib "CertificateTemplate:WebServer" patchwork.csr patchwork.cer</code>. certreq
              fragt nach der Zertifizierungsstelle. «WebServer» ist der interne Name der Vorlage «Webserver»; die Vorlagen der
              Zertifizierungsstelle zeigt <code>certutil -CATemplates</code>.
            </li>
            <li>
              Meldet certreq, dass die Anforderung aussteht: in der Zertifizierungsstelle (<code>certsrv.msc</code>) unter
              «Ausstehende Anforderungen» ausstellen, dann mit <code>certreq -retrieve &lt;Anforderungs-ID&gt; patchwork.cer</code>
              abholen.
            </li>
            <li>
              Alternativ über die Webseite der Zertifizierungsstelle (<code>…/certsrv</code>): Zertifikat anfordern → erweiterte
              Anforderung → Inhalt der Anforderung einfügen → Vorlage «Webserver» → Base64-codiert herunterladen.
            </li>
            <li>Die Datei <code>patchwork.cer</code> unten hochladen.</li>
          </ol>
        </template>
        <template v-else>
          <div class="field">
            <label for="tls-names">Namen (DNS)</label>
            <input id="tls-names" v-model="names" class="input" placeholder="patchwork.firma.local" />
            <span class="hint">
              Unter diesen Namen rufen die Benutzer Patchwork auf, mehrere mit Komma getrennt. Der erste wird der Name (CN) des
              Zertifikats, alle stehen im SAN.
            </span>
          </div>
          <div>
            <button class="btn btn-primary" type="button" :disabled="busy || !names.trim()" @click="createRequest">
              Anforderung erstellen
            </button>
          </div>
        </template>
      </div>

      <div class="card card-body stack">
        <h2>Signiertes Zertifikat hochladen</h2>
        <div class="row">
          <label class="btn" :class="{ 'btn-primary': status.pending }">
            Zertifikat hochladen …
            <input ref="fileInput" type="file" accept=".cer,.crt,.pem,.der,.p7b,.rsp" hidden :disabled="busy" @change="upload" />
          </label>
        </div>
        <span class="hint faint">
          .cer, .crt oder .pem (Base64 oder DER) oder eine Kette als .p7b. Es muss zur offenen Anforderung passen. Patchwork
          übernimmt es sofort, ohne Neustart.
        </span>
        <div v-if="uploadError" class="error-box">{{ uploadError }}</div>
      </div>
    </template>
  </div>
</template>

<style scoped>
.intro {
  margin: 0;
}
h3 {
  margin-top: 6px;
}
.facts {
  display: grid;
  grid-template-columns: max-content 1fr;
  gap: 4px 16px;
  margin: 0;
}
.facts dt {
  color: var(--text-muted);
}
.facts dd {
  margin: 0;
}
.expiry-warning {
  color: var(--danger);
  font-weight: 500;
}
.warning-box {
  padding: 10px 12px;
  border-radius: var(--radius-sm);
  background: var(--warning-soft);
  color: var(--warning);
}
.csr {
  font-size: 12px;
}
.steps {
  margin: 0;
  padding-left: 20px;
  display: flex;
  flex-direction: column;
  gap: 8px;
}
code {
  font-family: var(--mono);
  font-size: 12px;
  background: var(--surface-2);
  padding: 1px 4px;
  border-radius: 4px;
}
</style>
