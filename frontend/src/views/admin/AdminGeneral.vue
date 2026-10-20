<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { api } from '../../api';
import PersonSearch from '../../components/PersonSearch.vue';
import { useSession } from '../../stores/session';
import { useToast } from '../../stores/toast';
import { testModeText } from '../../test-mode';
import type { MailSettings, PersonPick, User } from '../../types';

const session = useSession();
const toast = useToast();
const appName = ref('');
const saving = ref(false);
const fileInput = ref<HTMLInputElement | null>(null);
/** Testbetrieb: Empfängerkreise für IT-Mitarbeitende und alle übrigen */
const delivery = ref<MailSettings | null>(null);
const staffUsers = ref<User[]>([]);
const savingDelivery = ref(false);

onMounted(async () => {
  try {
    const [general, mail, staff] = await Promise.all([
      api.get<{ appName: string }>('/settings/general'),
      api.get<MailSettings>('/settings/mail'),
      api.get<User[]>('/users/staff'),
    ]);
    appName.value = general.appName;
    delivery.value = mail;
    staffUsers.value = staff;
  } catch (err) {
    toast.error(err);
  }
});

const deliverySummary = computed(() =>
  delivery.value ? (testModeText(delivery.value) ?? 'Normaler Betrieb: Alle Mails werden versendet.') : '',
);

function toggleStaff(email: string, checked: boolean) {
  const d = delivery.value;
  if (!d) return;
  d.staffEmails = checked ? [...new Set([...d.staffEmails, email])] : d.staffEmails.filter((e) => e !== email);
}

function addOther(person: PersonPick) {
  const d = delivery.value;
  if (d && !d.otherEmails.includes(person.email)) d.otherEmails = [...d.otherEmails, person.email];
}

function removeOther(email: string) {
  if (delivery.value) delivery.value.otherEmails = delivery.value.otherEmails.filter((e) => e !== email);
}

async function saveDelivery() {
  if (!delivery.value) return;
  savingDelivery.value = true;
  try {
    delivery.value = await api.put<MailSettings>('/settings/mail', { ...delivery.value });
    await session.loadInfo();
    toast.success(session.info?.testMode ? 'Testbetrieb gespeichert' : 'Normaler Betrieb: Alle Mails werden versendet');
  } catch (err) {
    toast.error(err);
  } finally {
    savingDelivery.value = false;
  }
}

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
      <h2>Testbetrieb</h2>
      <span class="hint faint">
        Legt fest, wer Mails tatsächlich erhält. Alle übrigen Mails stellt Patchwork wie gewohnt zusammen, versendet sie aber
        nicht; sie stehen unter <RouterLink to="/admin/ausgehende-mails?status=nicht-versendet">Ausgehende Mails</RouterLink>
        und werden später nicht nachträglich versendet. Massgebend ist der Empfänger: IT-Mitarbeitende sind Benutzer mit der Rolle IT oder Admin.
        Geht eine Mail nur an einen Teil der Empfänger, stehen im Kopf nur diese. Solange nicht beide Kreise auf «an alle»
        stehen, sehen alle Benutzer oben einen Hinweis.
      </span>
      <template v-if="delivery">
        <div class="field">
          <label for="tm-staff">Mails an IT-Mitarbeitende</label>
          <select id="tm-staff" v-model="delivery.staff" class="select scope">
            <option value="none">an niemanden (nur zusammenstellen)</option>
            <option value="selected">nur an ausgewählte</option>
            <option value="all">an alle</option>
          </select>
          <div v-if="delivery.staff === 'selected'" class="choices">
            <label v-for="u in staffUsers" :key="u.id" class="checkbox">
              <input
                type="checkbox"
                :checked="delivery.staffEmails.includes(u.email)"
                @change="toggleStaff(u.email, ($event.target as HTMLInputElement).checked)"
              />
              {{ u.name }} <span class="faint">{{ u.email }}</span>
            </label>
            <span v-if="!staffUsers.length" class="faint">Keine Benutzer mit der Rolle IT oder Admin.</span>
          </div>
        </div>
        <div class="field">
          <label for="tm-others">Mails an Melder, Beteiligte und alle übrigen</label>
          <select id="tm-others" v-model="delivery.others" class="select scope">
            <option value="none">an niemanden (nur zusammenstellen)</option>
            <option value="selected">nur an ausgewählte</option>
            <option value="all">an alle</option>
          </select>
          <div v-if="delivery.others === 'selected'" class="choices">
            <div v-if="delivery.otherEmails.length" class="chips">
              <span v-for="email in delivery.otherEmails" :key="email" class="chip">
                {{ email }}
                <button type="button" class="chip-remove" :title="`${email} entfernen`" @click="removeOther(email)">×</button>
              </span>
            </div>
            <span v-else class="faint">Noch niemand ausgewählt.</span>
            <PersonSearch placeholder="Person hinzufügen (Name, Benutzername, E-Mail)" :exclude="delivery.otherEmails" @pick="addOther" />
          </div>
        </div>
        <div class="row">
          <button class="btn btn-primary" type="button" :disabled="savingDelivery" @click="saveDelivery">Speichern</button>
          <span class="faint">{{ deliverySummary }}</span>
        </div>
      </template>
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
  </div>
</template>

<style scoped>
.scope {
  max-width: 320px;
}
.choices {
  display: flex;
  flex-direction: column;
  gap: 6px;
  margin-top: 6px;
  padding-left: 12px;
  border-left: 2px solid var(--border);
}
.chips {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}
.chip {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 2px 4px 2px 10px;
  border-radius: 999px;
  background: var(--surface-2);
  border: 1px solid var(--border);
  font-size: 13px;
}
.chip-remove {
  border: none;
  background: none;
  color: var(--text-muted);
  cursor: pointer;
  font-size: 15px;
  line-height: 1;
  padding: 0 4px;
}
.chip-remove:hover {
  color: var(--danger);
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
</style>
