<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue';
import { api, errorMessage } from '../api';
import { formatDay, PRIORITY_LABELS, TITLE_MAX, today } from '../format';
import type { ItemKey } from '../item-ref';
import { dayWithWeekday, leadText, MONTHS, NTH_LABELS, TITLE_PLACEHOLDERS, WEEKDAYS, WEEKDAYS_SHORT } from '../recurrence-text';
import { manualStatusChoices } from '../status-move';
import { useConfirm } from '../stores/confirm';
import { useSession } from '../stores/session';
import { useToast } from '../stores/toast';
import type { ChecklistTemplate, Recurrence, RecurringOccurrence, RecurringTask, RecurringTaskFields } from '../types';
import ItemLink from './ItemLink.vue';
import MarkdownEditor from './MarkdownEditor.vue';
import ModalDialog from './ModalDialog.vue';
import StatusBadge from './StatusBadge.vue';
import TitleCount from './TitleCount.vue';

/**
 * Wiederkehrende Aufgabe anlegen oder bearbeiten: Inhalt der Aufgaben, Rhythmus und Vorschau der nächsten Termine. Bei
 * einer bestehenden zusätzlich die zuletzt angelegten Aufgaben, «Jetzt anlegen» und «Löschen».
 */
const props = defineProps<{ task: RecurringTask | null }>();
const emit = defineEmits<{ close: []; saved: []; created: [item: ItemKey] }>();
const session = useSession();
const toast = useToast();
const confirm = useConfirm();

// Im Template nicht als Text mit geschweiften Klammern (die Interpolation endet beim ersten «}}»)
const placeholderTags = TITLE_PLACEHOLDERS.map((p) => `{{${p}}}`);

const weekdayOf = (date: string) => ((new Date(`${date}T00:00:00Z`).getUTCDay() + 6) % 7) + 1;

// Meldeweg wie beim Erfassen einer Aufgabe: vorbelegt, falls unter Verwaltung → Meldewege eingestellt
const channelOptions = computed(() => session.channels.filter((c) => c.key !== 'portal'));
const defaultChannel = session.channelDefaults.task && channelOptions.value.some((c) => c.id === session.channelDefaults.task) ? session.channelDefaults.task : null;

/** Vergleichbarer Stand: Schlüssel sortiert (die Datenbank liefert JSON mit eigener Reihenfolge der Schlüssel) */
const stable = (value: unknown) =>
  JSON.stringify(value, (_key, v: unknown) =>
    v && typeof v === 'object' && !Array.isArray(v) ? Object.fromEntries(Object.entries(v).sort(([a], [b]) => a.localeCompare(b))) : v,
  );

function initial(): RecurringTaskFields {
  if (props.task) {
    const { id: _id, creator: _c, next: _n, recent: _r, createdAt: _ca, updatedAt: _ua, ...fields } = props.task;
    // Kopie ohne Bezug zu den reaktiven Daten der Liste
    return JSON.parse(JSON.stringify(fields)) as RecurringTaskFields;
  }
  const start = today();
  return {
    title: '',
    description: '',
    priority: 'normal',
    statusId: null,
    assigneeId: null,
    channelId: defaultChannel,
    checklists: [],
    schedule: { kind: 'monthlyDay', interval: 1, day: Number(start.slice(8, 10)) },
    startDate: start,
    endDate: null,
    weekend: 'keep',
    leadDays: 0,
    active: true,
  };
}
const draft = ref<RecurringTaskFields>(initial());
const saved = stable(draft.value);
const dirty = computed(() => stable(draft.value) !== saved);

// Teile des Rhythmus je Art, damit beim Wechsel der Art nichts verloren geht; vorbelegt aus dem Startdatum
const start = draft.value.startDate;
const s = draft.value.schedule;
const startDay = Number(start.slice(8, 10));
const parts = ref({
  kind: s.kind,
  interval: s.interval,
  weekdays: s.kind === 'weekly' ? [...s.weekdays] : [weekdayOf(start)],
  day: s.kind === 'monthlyDay' ? s.day : startDay,
  nth: s.kind === 'monthlyWeekday' ? s.nth : Math.min(4, Math.ceil(startDay / 7)),
  weekday: s.kind === 'monthlyWeekday' ? s.weekday : weekdayOf(start),
  month: s.kind === 'yearly' ? s.month : Number(start.slice(5, 7)),
  yearDay: s.kind === 'yearly' ? s.day : startDay,
});
const schedule = computed<Recurrence>(() => {
  const p = parts.value;
  const interval = Number(p.interval) || 1;
  switch (p.kind) {
    case 'daily':
      return { kind: 'daily', interval };
    case 'weekly':
      return { kind: 'weekly', interval, weekdays: [...p.weekdays].sort() };
    case 'monthlyDay':
      return { kind: 'monthlyDay', interval, day: Number(p.day) };
    case 'monthlyWeekday':
      return { kind: 'monthlyWeekday', interval, nth: Number(p.nth), weekday: Number(p.weekday) };
    case 'yearly':
      return { kind: 'yearly', interval, month: Number(p.month), day: Number(p.yearDay) };
  }
  return { kind: 'daily', interval };
});
watch(schedule, (value) => (draft.value.schedule = value), { immediate: true });

const UNITS: Record<Recurrence['kind'], [string, string]> = {
  daily: ['Tag', 'Tage'],
  weekly: ['Woche', 'Wochen'],
  monthlyDay: ['Monat', 'Monate'],
  monthlyWeekday: ['Monat', 'Monate'],
  yearly: ['Jahr', 'Jahre'],
};
const unit = computed(() => UNITS[parts.value.kind][Number(parts.value.interval) === 1 ? 0 : 1]);
const daysOfMonth = Array.from({ length: 31 }, (_, i) => i + 1);

function toggleWeekday(day: number) {
  const days = parts.value.weekdays;
  parts.value.weekdays = days.includes(day) ? days.filter((d) => d !== day) : [...days, day];
}

// Status: offene Status der Aufgaben ausser dem Ablehnen-Status; ohne Wahl der Start-Status
const statusOptions = computed(() =>
  manualStatusChoices(session.statusesOf('task'), session.statusTargets.task, null).filter((st) => !st.closed),
);
const startLabel = computed(() => session.statuses.find((st) => st.id === session.statusTargets.task.start)?.label);

// Checklisten: Punkte als Text, eine Zeile pro Punkt
const lists = ref(draft.value.checklists.map((c) => ({ title: c.title, items: c.items.join('\n') })));
watch(
  lists,
  (value) => {
    draft.value.checklists = value.map((c) => ({
      title: c.title,
      items: c.items
        .split('\n')
        .map((l) => l.trim())
        .filter(Boolean),
    }));
  },
  { deep: true },
);
const templates = ref<ChecklistTemplate[]>([]);
const templateId = ref('');
onMounted(async () => {
  try {
    templates.value = await api.get<ChecklistTemplate[]>('/checklist-templates');
  } catch {
    // Ohne Vorlagen lassen sich Checklisten trotzdem von Hand erfassen
  }
});
function addTemplate() {
  const t = templates.value.find((x) => x.id === templateId.value);
  if (t) lists.value.push({ title: t.name, items: t.items.join('\n') });
  templateId.value = '';
}

// Vorschau der nächsten Termine (ohne bereits angelegte), kurz nach jeder Änderung
const preview = ref<RecurringOccurrence[]>([]);
const previewError = ref('');
let timer: ReturnType<typeof setTimeout> | undefined;
watch(
  () => {
    const d = draft.value;
    return JSON.stringify([d.title, d.schedule, d.startDate, d.endDate, d.weekend, d.leadDays]);
  },
  () => {
    clearTimeout(timer);
    timer = setTimeout(loadPreview, 300);
  },
  { immediate: true },
);
async function loadPreview() {
  const d = draft.value;
  try {
    preview.value = await api.post<RecurringOccurrence[]>('/recurring-tasks/preview', {
      id: props.task?.id ?? null,
      title: d.title.trim() || 'Ohne Titel',
      schedule: d.schedule,
      startDate: d.startDate,
      endDate: d.endDate || null,
      weekend: d.weekend,
      leadDays: Number(d.leadDays) || 0,
    });
    previewError.value = '';
  } catch (err) {
    preview.value = [];
    previewError.value = errorMessage(err);
  }
}

const error = ref('');
const busy = ref(false);

function payload(): Record<string, unknown> {
  const d = draft.value;
  return { ...d, endDate: d.endDate || null, leadDays: Number(d.leadDays) || 0 } satisfies RecurringTaskFields;
}

async function save() {
  error.value = '';
  if (!draft.value.title.trim()) {
    error.value = 'Bitte einen Titel eingeben.';
    return;
  }
  if (!draft.value.channelId) {
    error.value = 'Bitte den Meldeweg wählen.';
    return;
  }
  busy.value = true;
  try {
    if (props.task) await api.put(`/recurring-tasks/${props.task.id}`, payload());
    else await api.post('/recurring-tasks', payload());
    toast.success('Wiederkehrende Aufgabe gespeichert');
    emit('saved');
  } catch (err) {
    error.value = errorMessage(err);
  } finally {
    busy.value = false;
  }
}

async function createNow() {
  if (!props.task) return;
  busy.value = true;
  error.value = '';
  try {
    emit('created', await api.post<ItemKey>(`/recurring-tasks/${props.task.id}/create-now`));
  } catch (err) {
    error.value = errorMessage(err);
  } finally {
    busy.value = false;
  }
}

async function remove() {
  if (!props.task) return;
  const ok = await confirm.ask({
    title: 'Wiederkehrende Aufgabe löschen',
    message: `«${props.task.title}» löschen? Bereits angelegte Aufgaben bleiben erhalten.`,
    confirmLabel: 'Löschen',
    danger: true,
  });
  if (!ok) return;
  try {
    await api.delete(`/recurring-tasks/${props.task.id}`);
    toast.success('Wiederkehrende Aufgabe gelöscht');
    emit('saved');
  } catch (err) {
    error.value = errorMessage(err);
  }
}
</script>

<template>
  <ModalDialog :title="task ? 'Wiederkehrende Aufgabe' : 'Neue wiederkehrende Aufgabe'" wide @close="emit('close')">
    <div class="field">
      <label for="rec-title">Titel</label>
      <input id="rec-title" v-model="draft.title" class="input" :maxlength="TITLE_MAX" placeholder="z.B. Patchday {{Monat}} {{Jahr}}" autofocus />
      <TitleCount :value="draft.title" />
      <span class="hint">
        Platzhalter für den Termin:
        <code v-for="p in placeholderTags" :key="p" class="placeholder">{{ p }}</code>
      </span>
    </div>
    <div class="field">
      <span class="label">Beschreibung</span>
      <MarkdownEditor v-model="draft.description" :images="false" :min-height="100" placeholder="Was ist jeweils zu tun?" />
    </div>
    <div class="grid-2">
      <div class="field">
        <label for="rec-assignee">Zuständig</label>
        <select id="rec-assignee" v-model="draft.assigneeId" class="select">
          <option :value="null">– niemand –</option>
          <option v-for="u in session.staff" :key="u.id" :value="u.id">{{ u.name }}</option>
        </select>
      </div>
      <div class="field">
        <label for="rec-priority">Priorität</label>
        <select id="rec-priority" v-model="draft.priority" class="select">
          <option v-for="(label, key) in PRIORITY_LABELS" :key="key" :value="key">{{ label }}</option>
        </select>
      </div>
      <div class="field">
        <label for="rec-status">Status</label>
        <select id="rec-status" v-model="draft.statusId" class="select">
          <option :value="null">{{ startLabel ? `Standard («${startLabel}»)` : 'Standard' }}</option>
          <option v-for="st in statusOptions" :key="st.id" :value="st.id">{{ st.label }}</option>
        </select>
      </div>
      <div class="field">
        <label for="rec-channel">Meldeweg</label>
        <select id="rec-channel" v-model="draft.channelId" class="select">
          <option :value="null" disabled>Bitte wählen …</option>
          <option v-for="c in channelOptions" :key="c.id" :value="c.id">{{ c.label }}</option>
        </select>
      </div>
    </div>

    <div class="field">
      <span class="label">Checklisten</span>
      <div v-for="(list, i) in lists" :key="i" class="checklist">
        <div class="row">
          <input v-model="list.title" class="input" maxlength="200" placeholder="Titel der Checkliste" :aria-label="`Titel der Checkliste ${i + 1}`" />
          <button class="btn btn-sm" type="button" @click="lists.splice(i, 1)">Entfernen</button>
        </div>
        <textarea v-model="list.items" class="textarea" rows="4" placeholder="Ein Punkt pro Zeile" :aria-label="`Punkte der Checkliste ${i + 1}`" />
      </div>
      <div class="row">
        <button class="btn btn-sm" type="button" @click="lists.push({ title: '', items: '' })">+ Checkliste</button>
        <select v-if="templates.length" v-model="templateId" class="select select-sm" aria-label="Vorlage einfügen" @change="addTemplate">
          <option value="">Vorlage einfügen …</option>
          <option v-for="t in templates" :key="t.id" :value="t.id">{{ t.name }}</option>
        </select>
      </div>
    </div>

    <fieldset class="rhythm">
      <legend>Rhythmus</legend>
      <div class="row wrap">
        <select v-model="parts.kind" class="select kind" aria-label="Art">
          <option value="daily">Täglich</option>
          <option value="weekly">Wöchentlich</option>
          <option value="monthlyDay">Monatlich an einem Tag</option>
          <option value="monthlyWeekday">Monatlich an einem Wochentag</option>
          <option value="yearly">Jährlich</option>
        </select>
        <label class="inline">
          alle
          <input v-model.number="parts.interval" class="input number" type="number" min="1" max="99" aria-label="Abstand" />
          {{ unit }}
        </label>
      </div>
      <div v-if="parts.kind === 'weekly'" class="weekdays" role="group" aria-label="Wochentage">
        <button
          v-for="(label, i) in WEEKDAYS_SHORT"
          :key="label"
          type="button"
          class="btn btn-sm"
          :class="{ chosen: parts.weekdays.includes(i + 1) }"
          :aria-pressed="parts.weekdays.includes(i + 1)"
          :title="WEEKDAYS[i]"
          @click="toggleWeekday(i + 1)"
        >
          {{ label }}
        </button>
      </div>
      <div v-else-if="parts.kind === 'monthlyDay'" class="row">
        am
        <select v-model.number="parts.day" class="select narrow" aria-label="Tag im Monat">
          <option v-for="d in daysOfMonth" :key="d" :value="d">{{ d }}.</option>
          <option :value="-1">letzten Tag</option>
        </select>
        <span v-if="parts.day > 28" class="hint">Hat ein Monat den Tag nicht, gilt sein letzter Tag.</span>
      </div>
      <div v-else-if="parts.kind === 'monthlyWeekday'" class="row">
        am
        <select v-model.number="parts.nth" class="select narrow" aria-label="Woche im Monat">
          <option v-for="[n, label] in NTH_LABELS" :key="n" :value="n">{{ label }}</option>
        </select>
        <select v-model.number="parts.weekday" class="select narrow" aria-label="Wochentag">
          <option v-for="(label, i) in WEEKDAYS" :key="label" :value="i + 1">{{ label }}</option>
        </select>
      </div>
      <div v-else-if="parts.kind === 'yearly'" class="row">
        am
        <select v-model.number="parts.yearDay" class="select narrow" aria-label="Tag">
          <option v-for="d in daysOfMonth" :key="d" :value="d">{{ d }}.</option>
        </select>
        <select v-model.number="parts.month" class="select narrow" aria-label="Monat">
          <option v-for="(label, i) in MONTHS" :key="label" :value="i + 1">{{ label }}</option>
        </select>
      </div>

      <div class="grid-2">
        <div class="field">
          <label for="rec-start">Beginn</label>
          <input id="rec-start" v-model="draft.startDate" class="input" type="date" required />
        </div>
        <div class="field">
          <label for="rec-end">Ende (optional)</label>
          <input id="rec-end" v-model="draft.endDate" class="input" type="date" />
        </div>
        <div v-if="parts.kind !== 'weekly'" class="field">
          <label for="rec-weekend">Termin am Wochenende</label>
          <select id="rec-weekend" v-model="draft.weekend" class="select">
            <option value="keep">bleibt am Wochenende</option>
            <option value="monday">auf den Montag danach verschieben</option>
            <option value="friday">auf den Freitag davor verschieben</option>
          </select>
        </div>
        <div class="field">
          <label for="rec-lead">Anlegen</label>
          <div class="row">
            <input id="rec-lead" v-model.number="draft.leadDays" class="input number" type="number" min="0" max="60" />
            <span class="muted">Tage vor der Fälligkeit</span>
          </div>
          <span class="hint">Die Aufgabe entsteht {{ leadText(Number(draft.leadDays) || 0) }} um 06:00 Uhr.</span>
        </div>
      </div>
      <label class="checkbox">
        <input v-model="draft.active" type="checkbox" />
        Aktiv (ausgeschaltet entstehen keine Aufgaben)
      </label>
    </fieldset>

    <div class="field">
      <span class="label">Nächste Termine</span>
      <div v-if="previewError" class="hint">{{ previewError }}</div>
      <div v-else-if="!preview.length" class="hint">Keine weiteren Termine.</div>
      <ul v-else class="upcoming">
        <li v-for="o in preview" :key="o.on">
          <strong>{{ dayWithWeekday(o.due) }}</strong>
          <span class="occurrence-title">{{ o.title }}</span>
          <span v-if="o.createOn !== o.due" class="faint">angelegt am {{ formatDay(o.createOn) }}</span>
        </li>
      </ul>
    </div>

    <div v-if="task" class="field">
      <span class="label">Zuletzt angelegt</span>
      <div v-if="!task.recent.length" class="hint">Noch keine Aufgaben angelegt.</div>
      <ul v-else class="recent">
        <li v-for="r in task.recent" :key="`${r.prefix}-${r.number}`">
          <ItemLink :item-key="r" type="task">{{ r.prefix }}-{{ r.number }}</ItemLink>
          <span class="occurrence-title">{{ r.title }}</span>
          <StatusBadge :status="r.status" />
          <span v-if="r.dueDate" class="faint">fällig {{ formatDay(r.dueDate) }}</span>
        </li>
      </ul>
    </div>

    <div v-if="error" class="error-box">{{ error }}</div>
    <template #footer>
      <button v-if="task" class="btn btn-danger" type="button" :disabled="busy" @click="remove">Löschen</button>
      <span class="spacer" />
      <button
        v-if="task"
        class="btn"
        type="button"
        :disabled="busy || dirty || !task.next"
        :title="dirty ? 'Zuerst speichern' : 'Legt die Aufgabe des nächsten Termins sofort an'"
        @click="createNow"
      >
        Jetzt anlegen
      </button>
      <button class="btn" type="button" @click="emit('close')">Abbrechen</button>
      <button class="btn btn-primary" type="button" :disabled="busy" @click="save">Speichern</button>
    </template>
  </ModalDialog>
</template>

<style scoped>
.placeholder {
  margin-left: 4px;
  font-size: 12px;
}
.checklist {
  display: flex;
  flex-direction: column;
  gap: 6px;
  margin-bottom: 10px;
}
.checklist .input {
  flex: 1;
}
.select-sm {
  width: auto;
}
.rhythm {
  border: 1px solid var(--border);
  border-radius: var(--radius);
  padding: 10px 14px 12px;
  margin: 0 0 14px;
  display: flex;
  flex-direction: column;
  gap: 10px;
}
.rhythm legend {
  font-size: 13px;
  font-weight: 600;
  padding: 0 4px;
}
.wrap {
  flex-wrap: wrap;
}
.kind {
  width: auto;
}
.inline {
  display: inline-flex;
  align-items: center;
  gap: 6px;
}
.number {
  width: 72px;
}
.narrow {
  width: auto;
}
.weekdays {
  display: flex;
  gap: 4px;
}
.weekdays .chosen {
  background: var(--accent);
  border-color: var(--accent);
  color: #fff;
}
.upcoming,
.recent {
  margin: 0;
  padding-left: 18px;
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.upcoming li,
.recent li {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}
.occurrence-title {
  min-width: 0;
}
</style>
