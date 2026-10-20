<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { api } from '../api';
import { useSession } from '../stores/session';
import { useToast } from '../stores/toast';
import { testModeText } from '../test-mode';
import type { MailSettings, PersonPick, User } from '../types';
import PersonSearch from './PersonSearch.vue';

/** Testbetrieb: Empfängerkreise für IT-Mitarbeitende und alle übrigen (Verwaltung → Ausgehende Mails). */
const emit = defineEmits<{ saved: [] }>();
const session = useSession();
const toast = useToast();
const delivery = ref<MailSettings | null>(null);
const staffUsers = ref<User[]>([]);
const saving = ref(false);

onMounted(async () => {
  try {
    const [mail, staff] = await Promise.all([api.get<MailSettings>('/settings/mail'), api.get<User[]>('/users/staff')]);
    delivery.value = mail;
    staffUsers.value = staff;
  } catch (err) {
    toast.error(err);
  }
});

const summary = computed(() =>
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

async function save() {
  if (!delivery.value) return;
  saving.value = true;
  try {
    delivery.value = await api.put<MailSettings>('/settings/mail', { ...delivery.value });
    await session.loadInfo();
    toast.success(session.info?.testMode ? 'Testbetrieb gespeichert' : 'Normaler Betrieb: Alle Mails werden versendet');
    emit('saved');
  } catch (err) {
    toast.error(err);
  } finally {
    saving.value = false;
  }
}
</script>

<template>
  <div class="card card-body stack">
    <h2>Testbetrieb</h2>
    <span class="hint faint">
      Legt fest, wer Mails tatsächlich erhält. Alle übrigen Mails stellt Patchwork wie gewohnt zusammen, versendet sie aber
      nicht; sie stehen unten in der Liste und werden später nicht nachträglich versendet. Massgebend ist der Empfänger:
      IT-Mitarbeitende sind Benutzer mit der Rolle IT oder Admin. Geht eine Mail nur an einen Teil der Empfänger, stehen im Kopf
      nur diese. Solange nicht beide Kreise auf «an alle» stehen, sehen alle Benutzer oben einen Hinweis.
    </span>
    <div v-if="delivery" class="grid-2 circles">
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
    </div>
    <div v-if="delivery" class="row">
      <button class="btn btn-primary" type="button" :disabled="saving" @click="save">Speichern</button>
      <span class="faint">{{ summary }}</span>
    </div>
  </div>
</template>

<style scoped>
.circles {
  align-items: start;
}
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
</style>
