<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { api } from '../../api';
import { useSession } from '../../stores/session';
import { useToast } from '../../stores/toast';
import type { Permission } from '../../types';

/**
 * Rechte je Rolle (Entscheid vom 20.11.2026, ersetzt «Bereiche der IT»): Rechte in Zeilen, Rollen in Spalten. Admins
 * haben immer alle Rechte, Standard-Benutzer keine (nur das Portal); die Rechte der IT stellt man ein. Gilt sofort.
 */
const toast = useToast();
const session = useSession();

const RIGHTS: { key: Permission; label: string; hint: string }[] = [
  { key: 'inbox', label: 'Eingang sehen und bearbeiten', hint: 'Vorgänge ohne Typ, Mails importieren' },
  { key: 'incident', label: 'Störungen sehen und bearbeiten', hint: 'Liste, Board und Vorgänge vom Typ Störung' },
  { key: 'task', label: 'Aufgaben sehen und bearbeiten', hint: 'Liste, Board, wiederkehrende Aufgaben' },
  { key: 'plansView', label: 'Pläne ansehen', hint: 'Standorte, Gebäude, Stockwerke und Räume; suchen, messen, drucken' },
  { key: 'plansEdit', label: 'Pläne bearbeiten', hint: 'Anlegen, zeichnen, löschen; schliesst «Pläne ansehen» ein' },
  { key: 'reports', label: 'Auswertungen', hint: 'Kennzahlen, Diagramme, Export als CSV und PDF' },
  { key: 'admin', label: 'Verwaltung', hint: 'Alles unter Verwaltung (auch Benutzer und Rechte), Hinweise oben, im Namen schreiben, Antworten simulieren' },
];
/** Rechte, die einen Bereich zeigen: die IT braucht mindestens eines (Startseite) */
const AREA_RIGHTS: Permission[] = ['inbox', 'incident', 'task', 'plansView'];

const it = ref<Permission[] | null>(null);
const saved = ref<Permission[]>([]);
const saving = ref(false);

onMounted(async () => {
  try {
    it.value = (await api.get<{ it: Permission[] }>('/settings/permissions')).it;
    saved.value = [...it.value];
  } catch (err) {
    toast.error(err);
  }
});

/** «Pläne bearbeiten» schliesst «Pläne ansehen» ein */
function toggle(key: Permission, on: boolean) {
  if (!it.value) return;
  const set = new Set(it.value);
  if (on) set.add(key);
  else set.delete(key);
  if (key === 'plansEdit' && on) set.add('plansView');
  if (key === 'plansView' && !on) set.delete('plansEdit');
  it.value = RIGHTS.map((r) => r.key).filter((k) => set.has(k));
}

const missingArea = computed(() => !!it.value && !it.value.some((p) => AREA_RIGHTS.includes(p)));
const dirty = computed(() => !!it.value && it.value.join() !== saved.value.join());

async function save() {
  if (!it.value || missingArea.value) return;
  saving.value = true;
  try {
    it.value = (await api.put<{ it: Permission[] }>('/settings/permissions', { it: it.value })).it;
    saved.value = [...it.value];
    toast.success('Rechte gespeichert');
    // Zähler und Navigation des eigenen Kontos (bei «Als dieser Benutzer arbeiten» in anderen Tabs erst nach dem Neuladen)
    void session.refreshCounts();
  } catch (err) {
    toast.error(err);
  } finally {
    saving.value = false;
  }
}
</script>

<template>
  <div class="stack">
    <h1>Rechte</h1>
    <p class="muted intro">
      Was jede Rolle darf. Admins haben immer alle Rechte, Standard-Benutzer nutzen nur das Portal. Die Rechte der IT gelten
      sofort, auch für angemeldete Benutzer. Ohne Recht fehlt ein Bereich in Navigation, Zählern und Suche, und Links darauf
      sind gesperrt.
    </p>
    <div class="card table-wrap">
      <table v-if="it" class="table rights">
        <thead>
          <tr>
            <th>Recht</th>
            <th class="role">Admin</th>
            <th class="role">IT</th>
            <th class="role">Standard</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="r in RIGHTS" :key="r.key">
            <td>
              <div class="right-label">{{ r.label }}</div>
              <div class="faint small">{{ r.hint }}</div>
            </td>
            <td class="role">
              <input type="checkbox" checked disabled :aria-label="`Admin: ${r.label}`" title="Admins haben immer alle Rechte" />
            </td>
            <td class="role">
              <input
                type="checkbox"
                :checked="it.includes(r.key)"
                :aria-label="`IT: ${r.label}`"
                @change="toggle(r.key, ($event.target as HTMLInputElement).checked)"
              />
            </td>
            <td class="role">
              <input type="checkbox" disabled :aria-label="`Standard: ${r.label}`" title="Standard-Benutzer nutzen nur das Portal" />
            </td>
          </tr>
        </tbody>
      </table>
    </div>
    <div v-if="it" class="row">
      <button class="btn btn-primary" type="button" :disabled="saving || missingArea || !dirty" @click="save">Speichern</button>
      <span v-if="missingArea" class="error-text small">
        Die IT braucht mindestens eines dieser Rechte: Eingang, Störungen, Aufgaben oder Pläne ansehen.
      </span>
      <span v-else-if="dirty" class="unsaved small">Ungespeicherte Änderungen</span>
    </div>
    <p class="faint small note">
      Die Rolle eines Benutzers stellst du unter <RouterLink to="/admin/users">Benutzer</RouterLink> ein; mit LDAP/AD kommt sie
      aus den Gruppen für Admin und IT.
    </p>
  </div>
</template>

<style scoped>
.intro,
.note {
  margin: 0;
  max-width: 75ch;
}
.rights .role {
  width: 110px;
  text-align: center;
}
.rights td {
  vertical-align: middle;
}
.right-label {
  font-weight: 500;
}
.rights input[type='checkbox'] {
  width: 16px;
  height: 16px;
  accent-color: var(--accent);
}
.error-text {
  color: var(--danger);
}
.unsaved {
  color: var(--warning);
}
</style>
