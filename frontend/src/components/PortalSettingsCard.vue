<script setup lang="ts">
import { onMounted, ref } from 'vue';
import { api } from '../api';
import { useToast } from '../stores/toast';
import type { PersonPick, PortalSettings } from '../types';
import PersonSearch from './PersonSearch.vue';

/** Wer das Portal nutzen darf: niemand, nur ausgewählte (Personen und AD-Gruppe) oder alle (Verwaltung → Allgemein). */
const toast = useToast();
const portal = ref<PortalSettings | null>(null);
const ldapEnabled = ref(false);
const saving = ref(false);

onMounted(async () => {
  try {
    const [settings, ldap] = await Promise.all([
      api.get<PortalSettings>('/settings/portal'),
      api.get<{ enabled: boolean }>('/settings/ldap'),
    ]);
    portal.value = settings;
    ldapEnabled.value = ldap.enabled;
  } catch (err) {
    toast.error(err);
  }
});

function add(person: PersonPick) {
  const p = portal.value;
  if (p && !p.emails.includes(person.email)) p.emails = [...p.emails, person.email];
}

function remove(email: string) {
  if (portal.value) portal.value.emails = portal.value.emails.filter((e) => e !== email);
}

async function save() {
  if (!portal.value) return;
  saving.value = true;
  try {
    portal.value = await api.put<PortalSettings>('/settings/portal', { ...portal.value });
    toast.success(
      portal.value.access === 'none' ? 'Portal ausgeschaltet' : portal.value.access === 'all' ? 'Portal für alle freigeschaltet' : 'Portal für die Ausgewählten freigeschaltet',
    );
  } catch (err) {
    toast.error(err);
  } finally {
    saving.value = false;
  }
}
</script>

<template>
  <div class="card card-body stack">
    <h2>Portal</h2>
    <span class="hint faint">
      Im Portal sehen Melder ihre eigenen Vorgänge, erfassen neue und antworten. Wer nicht freigeschaltet ist, kann sich nicht
      anmelden, und Mails an diese Melder enthalten keinen Link zum Portal. Für IT und Admins ändert sich nichts.
    </span>
    <div v-if="portal" class="field">
      <label for="portal-access">Portal nutzen dürfen</label>
      <select id="portal-access" v-model="portal.access" class="select scope">
        <option value="none">niemand (Portal aus)</option>
        <option value="selected">nur ausgewählte</option>
        <option value="all">alle</option>
      </select>
    </div>
    <div v-if="portal && portal.access === 'selected'" class="choices">
      <span class="label">Personen</span>
      <div v-if="portal.emails.length" class="chips">
        <span v-for="email in portal.emails" :key="email" class="chip">
          {{ email }}
          <button type="button" class="chip-remove" :title="`${email} entfernen`" @click="remove(email)">×</button>
        </span>
      </div>
      <span v-else class="faint">Noch niemand ausgewählt.</span>
      <PersonSearch placeholder="Person hinzufügen (Name, Benutzername, E-Mail)" :exclude="portal.emails" @pick="add" />
      <div class="field">
        <label for="portal-group">AD-Gruppe (DN)</label>
        <input id="portal-group" v-model="portal.groupDn" class="input" maxlength="500" placeholder="CN=Portal,OU=Gruppen,DC=firma,DC=local" />
        <span class="hint">
          Die Mitglieder dieser Gruppe dürfen das Portal ebenfalls nutzen. Patchwork fragt dafür das Verzeichnis ab (Verwaltung →
          LDAP)<template v-if="!ldapEnabled">; die LDAP-Anmeldung ist zurzeit ausgeschaltet</template>.
        </span>
      </div>
    </div>
    <div v-if="portal" class="row">
      <button class="btn btn-primary" type="button" :disabled="saving" @click="save">Speichern</button>
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
</style>
