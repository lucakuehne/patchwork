<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import draggable from 'vuedraggable';
import { api, errorMessage } from '../../api';
import ModalDialog from '../../components/ModalDialog.vue';
import RuleConditionRow from '../../components/RuleConditionRow.vue';
import { CATEGORY_LABELS, formatDateTime, itemRef, PRIORITY_LABELS, TYPE_LABELS } from '../../format';
import {
  describeActions,
  describeConditions,
  describeTrigger,
  isReplyTrigger,
  SCHEDULE_CATEGORIES,
  TRIGGER_LABELS,
  TRIGGERS,
  type RuleLookups,
} from '../../rules-text';
import { useConfirm } from '../../stores/confirm';
import { useSession } from '../../stores/session';
import { useToast } from '../../stores/toast';
import type {
  ChecklistTemplate,
  ItemType,
  Mailbox,
  Priority,
  Rule,
  RuleActions,
  RuleCondition,
  RuleGroup,
  RulePreviewHit,
  RuleTrigger,
  ScheduleCategory,
} from '../../types';

const session = useSession();
const toast = useToast();
const confirm = useConfirm();

const rules = ref<Rule[]>([]);
const mailboxes = ref<Mailbox[]>([]);
const templates = ref<ChecklistTemplate[]>([]);

interface Draft {
  id: string | null;
  name: string;
  active: boolean;
  /** Bei Ereignissen (Mail, Portal, Antworten) oder nach Zeit */
  mode: 'event' | 'timed';
  triggers: RuleTrigger[];
  scheduleCategory: ScheduleCategory;
  scheduleDays: number;
  conditions: RuleGroup;
  type: ItemType | '';
  priority: Priority | '';
  assigneeId: string;
  checklistTemplateId: string;
  suppressConfirmation: boolean;
  discard: boolean;
  remindReporter: boolean;
  close: boolean;
}
const draft = ref<Draft | null>(null);
const error = ref('');
const saving = ref(false);
const preview = ref<{ hits: RulePreviewHit[]; more: boolean } | null>(null);
const previewing = ref(false);

const lookups = computed<RuleLookups>(() => ({
  mailbox: (id) => mailboxes.value.find((m) => m.id === id)?.name,
  user: (id) => session.staff.find((u) => u.id === id)?.name,
  template: (id) => templates.value.find((t) => t.id === id)?.name,
}));

async function load() {
  try {
    const [r, m, t] = await Promise.all([
      api.get<Rule[]>('/admin/rules'),
      api.get<Mailbox[]>('/admin/mailboxes'),
      api.get<ChecklistTemplate[]>('/checklist-templates'),
    ]);
    rules.value = r;
    mailboxes.value = m;
    templates.value = t;
  } catch (err) {
    toast.error(err);
  }
}
onMounted(load);

// ---------------------------------------------------------------- Liste

async function saveOrder() {
  try {
    await api.put('/admin/rules/order', { ids: rules.value.map((r) => r.id) });
  } catch (err) {
    toast.error(err);
    await load();
  }
}

async function setActive(rule: Rule, active: boolean) {
  try {
    await api.patch(`/admin/rules/${rule.id}/active`, { active });
    rule.active = active;
  } catch (err) {
    toast.error(err);
    await load();
  }
}

async function remove(rule: Rule) {
  const ok = await confirm.ask({
    title: 'Regel löschen',
    message: `Regel «${rule.name}» löschen? Bereits angewendete Änderungen bleiben bestehen.`,
    confirmLabel: 'Löschen',
    danger: true,
  });
  if (!ok) return;
  try {
    await api.delete(`/admin/rules/${rule.id}`);
    await load();
  } catch (err) {
    toast.error(err);
  }
}

// ---------------------------------------------------------------- Bearbeiten

const newCondition = (): RuleCondition => ({ kind: 'condition', field: 'sender', operator: 'domain', value: '' });

function create() {
  open({
    id: null,
    name: '',
    active: true,
    mode: 'event',
    triggers: ['mail_new'],
    scheduleCategory: 'waiting',
    scheduleDays: 7,
    conditions: { kind: 'group', op: 'and', children: [newCondition()] },
    type: '',
    priority: '',
    assigneeId: '',
    checklistTemplateId: '',
    suppressConfirmation: false,
    discard: false,
    remindReporter: false,
    close: false,
  });
}

function edit(rule: Rule) {
  const a = rule.actions;
  open({
    id: rule.id,
    name: rule.name,
    active: rule.active,
    mode: rule.schedule ? 'timed' : 'event',
    triggers: rule.schedule ? ['mail_new'] : [...rule.triggers],
    scheduleCategory: rule.schedule?.category ?? 'waiting',
    scheduleDays: rule.schedule?.days ?? 7,
    // Tiefe Kopie (structuredClone geht nicht mit reaktiven Objekten)
    conditions: JSON.parse(JSON.stringify(rule.conditions)) as RuleGroup,
    type: a.type ?? '',
    priority: a.priority ?? '',
    assigneeId: a.assigneeId ?? '',
    checklistTemplateId: a.checklistTemplateId ?? '',
    suppressConfirmation: !!a.suppressConfirmation,
    discard: !!a.discard,
    remindReporter: !!a.remindReporter,
    close: !!a.close,
  });
}

function open(d: Draft) {
  error.value = '';
  preview.value = null;
  draft.value = d;
}

function toggleTrigger(t: RuleTrigger, on: boolean) {
  if (!draft.value) return;
  const list = draft.value.triggers.filter((x) => x !== t);
  draft.value.triggers = on ? TRIGGERS.filter((x) => x === t || list.includes(x)) : list;
}

const timed = computed(() => draft.value?.mode === 'timed');
const timedWaiting = computed(() => timed.value && draft.value?.scheduleCategory === 'waiting');
const onlyReplies = computed(
  () => !timed.value && !!draft.value?.triggers.length && draft.value.triggers.every(isReplyTrigger),
);
const someReplies = computed(() => !timed.value && !!draft.value?.triggers.some(isReplyTrigger));

function addGroup(root: RuleGroup) {
  root.children.push({ kind: 'group', op: root.op === 'and' ? 'or' : 'and', children: [newCondition()] });
}

function removeChild(group: RuleGroup, index: number) {
  group.children.splice(index, 1);
}

/** Nur die Aktionen, die zur Art der Regel passen */
function actionsOf(d: Draft): RuleActions {
  const a: RuleActions = {};
  if (d.priority) a.priority = d.priority;
  if (d.assigneeId) a.assigneeId = d.assigneeId;
  if (d.mode === 'timed') {
    if (d.scheduleCategory === 'waiting' && d.remindReporter) a.remindReporter = true;
    if (d.scheduleCategory === 'waiting' && d.close) a.close = true;
    return a;
  }
  if (d.type) a.type = d.type;
  if (d.checklistTemplateId) a.checklistTemplateId = d.checklistTemplateId;
  if (d.suppressConfirmation) a.suppressConfirmation = true;
  if (d.discard) a.discard = true;
  return a;
}

/** Auslöser: Ereignisse oder Zeit */
const triggerOf = (d: Draft) => ({
  triggers: d.mode === 'event' ? d.triggers : [],
  schedule: d.mode === 'timed' ? { category: d.scheduleCategory, days: Number(d.scheduleDays) } : null,
});

async function save() {
  const d = draft.value;
  if (!d) return;
  saving.value = true;
  error.value = '';
  const body = { name: d.name, active: d.active, ...triggerOf(d), conditions: d.conditions, actions: actionsOf(d) };
  try {
    if (d.id) await api.put(`/admin/rules/${d.id}`, body);
    else await api.post('/admin/rules', body);
    draft.value = null;
    toast.success('Regel gespeichert');
    await load();
  } catch (err) {
    error.value = errorMessage(err);
  } finally {
    saving.value = false;
  }
}

async function runPreview() {
  const d = draft.value;
  if (!d) return;
  previewing.value = true;
  error.value = '';
  try {
    preview.value = await api.post<{ hits: RulePreviewHit[]; more: boolean }>('/admin/rules/preview', {
      ...triggerOf(d),
      conditions: d.conditions,
    });
  } catch (err) {
    error.value = errorMessage(err);
  } finally {
    previewing.value = false;
  }
}

</script>

<template>
  <div class="stack">
    <div class="page-head" style="margin: 0">
      <h1>Regeln</h1>
      <div class="spacer" />
      <button class="btn btn-primary" type="button" @click="create">+ Regel</button>
    </div>
    <p class="muted" style="margin: 0">
      Regeln wirken auf neue Mails und Portal-Meldungen, auf Antworten oder nach Zeit, z.B. «wartet seit 7 Tagen auf den Melder →
      erinnern». Sie werden von oben nach unten abgearbeitet: Setzen mehrere Regeln dasselbe, gilt die untere. «Verwerfen» und
      «Schliessen» beenden die Abarbeitung. Zeitgesteuerte Regeln prüft Patchwork alle 15 Minuten, pro Vorgang greifen sie einmal je
      Status. Reihenfolge per Ziehen ändern.
    </p>

    <div v-if="!rules.length" class="card empty">Noch keine Regeln.</div>
    <draggable v-else v-model="rules" item-key="id" handle=".handle" :animation="120" class="rule-list" @end="saveOrder">
      <template #item="{ element }">
        <div class="card rule" :class="{ inactive: !element.active }">
          <span class="handle" aria-hidden="true" title="Ziehen zum Sortieren">⋮⋮</span>
          <div class="rule-text">
            <div class="row">
              <strong>{{ element.name }}</strong>
              <span class="faint small">{{ describeTrigger(element) }}</span>
            </div>
            <div class="small">
              <template v-if="element.conditions.children.length">
                <span class="muted">Wenn</span> {{ describeConditions(element.conditions, lookups) }}
              </template>
              <span v-else class="muted">Immer</span>
              <span class="muted">→</span> {{ describeActions(element.actions, lookups) }}
            </div>
          </div>
          <label class="checkbox small" title="Regel ein- oder ausschalten">
            <input type="checkbox" :checked="element.active" @change="setActive(element, ($event.target as HTMLInputElement).checked)" />
            Aktiv
          </label>
          <button class="btn btn-sm" type="button" @click="edit(element)">Bearbeiten</button>
          <button class="btn btn-sm btn-danger" type="button" @click="remove(element)">Löschen</button>
        </div>
      </template>
    </draggable>

    <ModalDialog v-if="draft" wide :title="draft.id ? 'Regel bearbeiten' : 'Neue Regel'" @close="draft = null">
      <div class="field">
        <label for="rule-name">Name</label>
        <input id="rule-name" v-model="draft.name" class="input" maxlength="200" placeholder="z.B. Lieferant Muster AG" autofocus />
      </div>

      <div class="field">
        <div class="row">
          <span class="label">Auslöser</span>
          <div class="segmented op">
            <button type="button" :class="{ active: draft.mode === 'event' }" @click="draft.mode = 'event'">bei Ereignissen</button>
            <button type="button" :class="{ active: draft.mode === 'timed' }" @click="draft.mode = 'timed'">nach Zeit</button>
          </div>
        </div>
        <div v-if="draft.mode === 'event'" class="triggers">
          <label v-for="t in TRIGGERS" :key="t" class="checkbox">
            <input type="checkbox" :checked="draft.triggers.includes(t)" @change="toggleTrigger(t, ($event.target as HTMLInputElement).checked)" />
            {{ TRIGGER_LABELS[t] }}
          </label>
        </div>
        <template v-else>
          <div class="timed">
            Vorgang ist seit
            <input v-model.number="draft.scheduleDays" class="input days" type="number" min="1" max="365" aria-label="Tage" />
            Tagen in einem Status der Kategorie
            <select v-model="draft.scheduleCategory" class="select category" aria-label="Kategorie">
              <option v-for="c in SCHEDULE_CATEGORIES" :key="c" :value="c">{{ CATEGORY_LABELS[c] }}</option>
            </select>
          </div>
          <span class="hint">
            Gezählt ab dem letzten Statuswechsel. Die Bedingungen beziehen sich auf den Vorgang: Absender = Melder, Betreff = Titel, Text
            = Beschreibung, Postfach = Antwort-Postfach.
          </span>
        </template>
      </div>

      <div class="field">
        <div class="row">
          <span class="label">Bedingungen</span>
          <div class="segmented op">
            <button type="button" :class="{ active: draft.conditions.op === 'and' }" @click="draft.conditions.op = 'and'">alle (UND)</button>
            <button type="button" :class="{ active: draft.conditions.op === 'or' }" @click="draft.conditions.op = 'or'">mindestens eine (ODER)</button>
          </div>
        </div>
        <div class="conditions">
          <template v-for="(child, i) in draft.conditions.children" :key="i">
            <span v-if="i > 0" class="joiner">{{ draft.conditions.op === 'and' ? 'und' : 'oder' }}</span>
            <RuleConditionRow
              v-if="child.kind === 'condition'"
              v-model="draft.conditions.children[i] as RuleCondition"
              :mailboxes="mailboxes"
              @remove="removeChild(draft.conditions, i)"
            />
            <div v-else class="subgroup">
              <div class="row">
                <span class="faint small">Gruppe:</span>
                <div class="segmented op">
                  <button type="button" :class="{ active: child.op === 'and' }" @click="child.op = 'and'">alle (UND)</button>
                  <button type="button" :class="{ active: child.op === 'or' }" @click="child.op = 'or'">mindestens eine (ODER)</button>
                </div>
                <span class="spacer" />
                <button class="btn btn-sm btn-ghost" type="button" @click="removeChild(draft.conditions, i)">Gruppe entfernen</button>
              </div>
              <template v-for="(c, j) in child.children" :key="j">
                <span v-if="j > 0" class="joiner">{{ child.op === 'and' ? 'und' : 'oder' }}</span>
                <RuleConditionRow
                  :model-value="c as RuleCondition"
                  :mailboxes="mailboxes"
                  @update:model-value="child.children[j] = $event"
                  @remove="child.children.length > 1 ? removeChild(child, j) : removeChild(draft.conditions, i)"
                />
              </template>
              <div>
                <button class="btn btn-sm" type="button" @click="child.children.push(newCondition())">+ Bedingung</button>
              </div>
            </div>
          </template>
          <span v-if="!draft.conditions.children.length" class="hint">Ohne Bedingung gilt die Regel für alles, was die Auslöser erfassen.</span>
          <div class="row">
            <button class="btn btn-sm" type="button" @click="draft.conditions.children.push(newCondition())">+ Bedingung</button>
            <button class="btn btn-sm" type="button" @click="addGroup(draft.conditions)">+ Gruppe</button>
          </div>
        </div>
      </div>

      <div class="field">
        <span class="label">Aktionen</span>
        <div class="actions-grid">
          <template v-if="!timed">
            <label for="rule-type">Typ</label>
            <select id="rule-type" v-model="draft.type" class="select" :disabled="draft.discard">
              <option value="">– nicht ändern –</option>
              <option v-for="(label, key) in TYPE_LABELS" :key="key" :value="key">{{ label }}</option>
            </select>
          </template>
          <label for="rule-priority">Priorität</label>
          <select id="rule-priority" v-model="draft.priority" class="select" :disabled="draft.discard">
            <option value="">– nicht ändern –</option>
            <option v-for="(label, key) in PRIORITY_LABELS" :key="key" :value="key">{{ label }}</option>
          </select>
          <label for="rule-assignee">Zuständig</label>
          <select id="rule-assignee" v-model="draft.assigneeId" class="select" :disabled="draft.discard">
            <option value="">– nicht ändern –</option>
            <option v-for="u in session.staff" :key="u.id" :value="u.id">{{ u.name }}</option>
          </select>
          <template v-if="!timed">
            <label for="rule-template">Checklisten-Vorlage</label>
            <select id="rule-template" v-model="draft.checklistTemplateId" class="select" :disabled="draft.discard || onlyReplies">
              <option value="">– keine –</option>
              <option v-for="t in templates" :key="t.id" :value="t.id">{{ t.name }}</option>
            </select>
          </template>
        </div>
        <template v-if="timed">
          <label class="checkbox">
            <input v-model="draft.remindReporter" type="checkbox" :disabled="!timedWaiting" />
            Melder per Mail erinnern
          </label>
          <label class="checkbox">
            <input v-model="draft.close" type="checkbox" :disabled="!timedWaiting" />
            Vorgang schliessen (erster Status «Erledigt», Mail an den Melder)
          </label>
          <span v-if="!timedWaiting" class="hint">Erinnern und Schliessen gibt es nur für die Kategorie «Wartend».</span>
        </template>
        <template v-else>
          <label class="checkbox">
            <input v-model="draft.suppressConfirmation" type="checkbox" :disabled="draft.discard || onlyReplies" />
            Keine Eingangsbestätigung schicken
          </label>
          <label class="checkbox">
            <input v-model="draft.discard" type="checkbox" :disabled="onlyReplies" />
            Verwerfen (z.B. Spam): ersetzt alle anderen Aktionen
          </label>
        </template>
        <span v-if="someReplies" class="hint">
          Bei Antworten wirken nur Priorität und Zuständig. Den Typ setzt die Regel nur, solange der Vorgang noch im Eingang liegt.
          Checkliste, Eingangsbestätigung und Verwerfen gelten nur für neue Vorgänge.
        </span>
        <span v-if="!timed && draft.checklistTemplateId && draft.type !== 'task'" class="hint">
          Die Checkliste wird nur eingefügt, wenn der Vorgang eine Aufgabe ist.
        </span>
      </div>

      <label class="checkbox">
        <input v-model="draft.active" type="checkbox" />
        Regel ist aktiv
      </label>

      <div v-if="preview" class="preview">
        <div class="label">{{ timed ? 'Vorschau: Vorgänge, bei denen die Regel jetzt greifen würde' : 'Vorschau: Treffer der letzten 30 Tage' }}</div>
        <div v-if="!preview.hits.length" class="faint small">Keine Treffer.</div>
        <div v-for="h in preview.hits" :key="`${h.kind}-${h.number}-${h.at}`" class="hit small">
          <RouterLink :to="`/v/${h.number}`" target="_blank" class="mono">{{ itemRef(h.number) }}</RouterLink>
          <span class="hit-title">{{ h.title }}</span>
          <span class="faint">
            {{ h.kind === 'new' ? 'neu' : h.kind === 'reply' ? 'Antwort' : 'im Status seit' }} · {{ h.sender }} · {{ formatDateTime(h.at) }}
          </span>
        </div>
        <div v-if="preview.more" class="faint small">Weitere Treffer werden nicht angezeigt.</div>
      </div>

      <div v-if="error" class="error-box">{{ error }}</div>
      <template #footer>
        <button class="btn" type="button" :disabled="previewing" @click="runPreview">{{ timed ? 'Vorschau (jetzt)' : 'Vorschau (30 Tage)' }}</button>
        <span class="spacer" />
        <button class="btn" type="button" @click="draft = null">Abbrechen</button>
        <button class="btn btn-primary" type="button" :disabled="saving" @click="save">Speichern</button>
      </template>
    </ModalDialog>
  </div>
</template>

<style scoped>
.small {
  font-size: 12px;
}
.rule-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.rule {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 10px 12px;
}
.rule.inactive {
  opacity: 0.6;
}
.rule-text {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 3px;
  overflow-wrap: anywhere;
}
.handle {
  cursor: grab;
  color: var(--text-faint);
  user-select: none;
}
.days {
  width: 72px;
  height: 28px;
  margin: 0 4px;
}
.timed {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 6px;
  margin-top: 6px;
}
.category {
  width: auto;
}
.triggers {
  display: flex;
  flex-wrap: wrap;
  gap: 6px 18px;
}
.op button {
  height: 26px;
  font-size: 12px;
}
.conditions {
  display: flex;
  flex-direction: column;
  gap: 6px;
  margin-top: 6px;
}
.joiner {
  font-size: 12px;
  color: var(--text-muted);
  padding-left: 4px;
}
.subgroup {
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 8px 10px;
  border: 1px dashed var(--border-strong);
  border-radius: var(--radius-sm);
  background: var(--surface-2);
}
.actions-grid {
  display: grid;
  grid-template-columns: 150px minmax(0, 1fr);
  gap: 6px 10px;
  align-items: center;
  margin-bottom: 6px;
}
.preview {
  border-top: 1px solid var(--border);
  padding-top: 10px;
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.hit {
  display: flex;
  gap: 8px;
  align-items: baseline;
  min-width: 0;
}
.hit-title {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
</style>
