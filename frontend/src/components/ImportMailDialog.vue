<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { api, errorMessage } from '../api';
import { formatDateTime } from '../format';
import type { MailImportPreview, MailImportRow } from '../types';
import ModalDialog from './ModalDialog.vue';

/**
 * Mails importieren (Entscheid vom 10.11.2026): Mails, die an eine andere Adresse gingen (z.B. eine persönliche), als
 * .eml oder .msg in den Eingang übernehmen, wie eine abgerufene Mail. Erst die Vorschau je Mail mit Hinweisen, dann
 * der Import der gewählten. Eine Weiterleitung (Absender in der IT) ist zuerst nicht gewählt.
 */
const props = defineProps<{ files: File[] }>();
const emit = defineEmits<{ close: []; done: [] }>();

const previews = ref<MailImportPreview[] | null>(null);
const selected = ref<number[]>([]);
const confirmation = ref(true);
const results = ref<MailImportRow[] | null>(null);
/** Vorschau zu jedem Ergebnis (gleiche Reihenfolge), für den Betreff */
const imported = ref<number[]>([]);
const busy = ref(false);
const error = ref('');

/** Lässt sich gar nicht importieren: nicht lesbar, ohne Absender, schon vorhanden oder von Patchwork selbst */
const blocked = (p: MailImportPreview) => !!p.error || !!p.duplicate || p.own;

const form = (indexes: number[]) => {
  const data = new FormData();
  for (const i of indexes) data.append('files', props.files[i]!, props.files[i]!.name);
  return data;
};

onMounted(async () => {
  try {
    const list = await api.post<MailImportPreview[]>('/mail-import/preview', form(props.files.map((_, i) => i)));
    previews.value = list;
    selected.value = list.flatMap((p, i) => (blocked(p) || p.staffSender ? [] : [i]));
  } catch (err) {
    error.value = errorMessage(err);
  }
});

const count = computed(() => selected.value.length);

async function submit() {
  busy.value = true;
  error.value = '';
  try {
    const indexes = [...selected.value].sort((a, b) => a - b);
    const data = form(indexes);
    data.append('confirmation', String(confirmation.value));
    imported.value = indexes;
    results.value = await api.post<MailImportRow[]>('/mail-import', data);
    emit('done');
  } catch (err) {
    error.value = errorMessage(err);
  } finally {
    busy.value = false;
  }
}

const sender = (p: MailImportPreview) => (p.from ? (p.from.name ? `${p.from.name} <${p.from.address}>` : p.from.address) : '–');
const where = (item: MailImportPreview['target']) =>
  item?.ref ? `Antwort in ${item.ref} «${item.title}»` : 'Antwort in einem bestehenden Vorgang';

function outcome(row: MailImportRow): string {
  switch (row.result) {
    case 'created':
      return row.item?.ref ? `${row.item.ref} im Eingang angelegt` : 'Im Eingang angelegt';
    case 'reply':
    case 'note':
    case 'automated':
      return row.item?.ref ? `An ${row.item.ref} angehängt` : 'An einen bestehenden Vorgang angehängt';
    case 'duplicate':
      return row.item?.ref ? `Übersprungen: schon in ${row.item.ref}` : 'Übersprungen: schon in Patchwork';
    case 'ignored':
      return `Ignoriert: ${row.reason ?? ''}`;
    default:
      return `Fehler: ${row.reason ?? ''}`;
  }
}
</script>

<template>
  <ModalDialog title="Mails importieren" wide @close="emit('close')">
    <p class="muted hint">
      Für Mails, die an eine andere Adresse gingen: Patchwork übernimmt sie wie eine Mail an das Postfach. Mit Nummer im
      Betreff oder als Antwort erkannt, kommen sie in den bestehenden Vorgang, sonst in den Eingang.
    </p>
    <div v-if="error" class="error-box">{{ error }}</div>
    <p v-if="!previews && !error" class="muted">Mails werden gelesen …</p>

    <template v-if="previews && !results">
      <ul class="mails">
        <li v-for="(p, i) in previews" :key="i" class="mail" :class="{ off: blocked(p) }">
          <label class="pick">
            <input v-model="selected" type="checkbox" :value="i" :disabled="blocked(p)" :aria-label="`${p.file} importieren`" />
            <span class="main">
              <span class="subject">{{ p.subject || p.file }}</span>
              <span class="faint small">
                Von {{ sender(p) }}<template v-if="p.date"> · gesendet {{ formatDateTime(p.date) }}</template>
                <template v-if="p.to.length"> · an {{ p.to.join(', ') }}</template>
              </span>
              <span v-if="!blocked(p)" class="small">{{ p.target ? where(p.target) : 'Neuer Vorgang im Eingang' }}</span>
            </span>
          </label>
          <span v-if="p.error" class="note danger">{{ p.file }}: {{ p.error }}</span>
          <span v-else-if="p.duplicate" class="note">
            Schon in Patchwork<template v-if="p.duplicate.ref">: {{ p.duplicate.ref }} «{{ p.duplicate.title }}»</template>
          </span>
          <span v-else-if="p.own" class="note">Absender ist ein Postfach von Patchwork, die Mail wird nicht übernommen.</span>
          <template v-else>
            <span v-if="p.staffSender" class="note warning">
              Absender ist in der IT: vermutlich eine Weiterleitung. Besser die ursprüngliche Mail importieren, sonst wird die
              weiterleitende Person Melder.
            </span>
            <span v-if="p.automated" class="note">Automatische Mail (z.B. Abwesenheitsnotiz), ohne Eingangsbestätigung.</span>
          </template>
        </li>
      </ul>
      <label class="checkbox">
        <input v-model="confirmation" type="checkbox" />
        Eingangsbestätigung an den Absender senden, mit Hinweis auf die richtige Adresse (nur bei neuen Vorgängen)
      </label>
    </template>

    <ul v-if="results" class="mails">
      <li v-for="(r, i) in results" :key="i" class="mail">
        <span class="subject">{{ previews?.[imported[i]!]?.subject || r.file }}</span>
        <span class="small" :class="{ danger: r.result === 'failed' }">
          <RouterLink v-if="r.item?.ref" :to="`/items/${r.item.ref}`" @click="emit('close')">{{ outcome(r) }}</RouterLink>
          <template v-else>{{ outcome(r) }}</template>
        </span>
      </li>
    </ul>

    <template #footer>
      <template v-if="results">
        <button class="btn btn-primary" type="button" @click="emit('close')">Schliessen</button>
      </template>
      <template v-else>
        <button class="btn" type="button" @click="emit('close')">Abbrechen</button>
        <button class="btn btn-primary" type="button" :disabled="busy || !count" @click="submit">
          {{ count === 1 ? '1 Mail importieren' : `${count} Mails importieren` }}
        </button>
      </template>
    </template>
  </ModalDialog>
</template>

<style scoped>
.hint {
  margin: 0;
  font-size: 13px;
}
.small {
  font-size: 12px;
}
.mails {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.mail {
  display: flex;
  flex-direction: column;
  gap: 4px;
  padding: 10px 12px;
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
}
.mail.off .main {
  opacity: 0.6;
}
.pick {
  display: flex;
  gap: 10px;
  align-items: flex-start;
  cursor: pointer;
}
.pick input {
  margin-top: 3px;
}
.main {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
  overflow-wrap: anywhere;
}
.subject {
  font-weight: 600;
}
.note {
  font-size: 12px;
  color: var(--text-muted);
}
.note.warning {
  color: var(--warning);
}
.danger,
.note.danger {
  color: var(--danger);
}
</style>
