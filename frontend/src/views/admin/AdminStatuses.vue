<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue';
import draggable from 'vuedraggable';
import { api, errorMessage } from '../../api';
import ModalDialog from '../../components/ModalDialog.vue';
import StatusColorPicker from '../../components/StatusColorPicker.vue';
import StatusFlowDiagram from '../../components/StatusFlowDiagram.vue';
import { TYPE_LABELS } from '../../format';
import { TARGET_SHORT, targetOptions, targetsAfterRemoval, targetsOf } from '../../status-admin';
import { REQUIRED_TARGETS, STATUS_TARGETS, TARGET_CLOSED, TARGET_LABELS } from '../../status-flow';
import { useSession } from '../../stores/session';
import { useToast } from '../../stores/toast';
import type { ItemType, Status, StatusColor, StatusFlow, StatusTarget, StatusTargetsByType } from '../../types';

const session = useSession();
const toast = useToast();
const types: ItemType[] = ['incident', 'task'];

/** Wann ein Ziel greift (siehe docs/Entscheidungen.md, Abschnitt Status) */
const TARGET_HINTS: Record<StatusTarget, string> = {
  start: 'Intern erfasste Vorgänge ohne Statuswahl, Typ im Eingang zugewiesen und Regelaktion «Typ».',
  reply:
    'Antwort des Melders oder eines Beteiligten, wenn der Vorgang auf ihn wartet oder abgeschlossen ist (nicht aus dem Ablehnen-Status).',
  close: 'Duplikat schliessen und zeitgesteuerte Regelaktion «Schliessen».',
  reject:
    'Aktion «Ablehnen» mit Begründung. Der Status ist nur so erreichbar, eine Antwort öffnet ihn nicht wieder. Ohne Status gibt es kein «Ablehnen».',
  waiting: 'Eine Antwort holt den Vorgang zurück, das Portal hebt ihn hervor, zeitgesteuerte Regeln können erinnern und schliessen.',
};
const noneLabel = (target: StatusTarget) => (target === 'reject' ? '– kein Ablehnen –' : '– keiner –');
const isRequired = (target: StatusTarget) => REQUIRED_TARGETS.includes(target);

type Draft = Record<StatusTarget, string>;
const emptyDraft = (): Draft => ({ start: '', reply: '', close: '', reject: '', waiting: '' });

/** Status je Typ in ihrer Reihenfolge (per Ziehen sortierbar) */
const lists = ref<Record<ItemType, Status[]>>({ incident: [], task: [] });
const usage = ref<Record<string, number>>({});
const newLabel = ref<Record<ItemType, string>>({ incident: '', task: '' });
const newClosed = ref<Record<ItemType, boolean>>({ incident: false, task: false });
/** Auswahl im Block «Automatische Wechsel» ('' = keiner) */
const targetDraft = ref<Record<ItemType, Draft>>({ incident: emptyDraft(), task: emptyDraft() });

async function load() {
  try {
    await session.loadStatuses();
    usage.value = await api.get<Record<string, number>>('/statuses/usage');
  } catch (err) {
    toast.error(err);
  }
  lists.value = { incident: session.statusesOf('incident'), task: session.statusesOf('task') };
  syncTargets();
}
onMounted(load);

function syncTargets() {
  const draftOf = (type: ItemType): Draft => {
    const draft = emptyDraft();
    for (const t of STATUS_TARGETS) draft[t] = session.statusTargets[type][t] ?? '';
    return draft;
  };
  targetDraft.value = { incident: draftOf('incident'), task: draftOf('task') };
}

/** Reihenfolge eines Typs speichern (gilt für die Spalten des Boards und alle Auswahllisten) */
async function onReorder(type: ItemType) {
  try {
    await api.put('/statuses/order', { type, ids: lists.value[type].map((s) => s.id) });
  } catch (err) {
    toast.error(err);
  }
  await load();
}

async function setColor(status: Status, color: StatusColor) {
  try {
    await api.patch(`/statuses/${status.id}`, { color });
  } catch (err) {
    toast.error(err);
  }
  await load();
}

async function rename(status: Status, e: Event) {
  const input = e.target as HTMLInputElement;
  const label = input.value.trim();
  if (!label || label === status.label) {
    input.value = status.label;
    return;
  }
  try {
    await api.patch(`/statuses/${status.id}`, { label });
  } catch (err) {
    toast.error(err);
    input.value = status.label;
  }
  await load();
}

/** Hinweis, warum «abgeschlossen» gesperrt ist: Jedes Ziel verlangt einen offenen bzw. abgeschlossenen Status */
function closedLock(status: Status): string | undefined {
  const target = targetsOf(session.statusTargets[status.type], status.id)[0];
  if (!target) return undefined;
  return (
    `«${status.label}» ist «${TARGET_LABELS[target]}» und muss ${TARGET_CLOSED[target] ? 'abgeschlossen' : 'offen'} bleiben. ` +
    'Zuerst unter «Automatische Wechsel» einen anderen Status wählen.'
  );
}

async function setClosed(status: Status, e: Event) {
  const input = e.target as HTMLInputElement;
  try {
    await api.patch(`/statuses/${status.id}`, { closed: input.checked });
  } catch (err) {
    toast.error(err);
    input.checked = status.closed;
  }
  await load();
}

async function add(type: ItemType) {
  const label = newLabel.value[type].trim();
  if (!label) return;
  try {
    await api.post('/statuses', { type, label, closed: newClosed.value[type] });
    newLabel.value[type] = '';
    newClosed.value[type] = false;
    await load();
  } catch (err) {
    toast.error(err);
  }
}

/** Status, die ein Ziel annehmen kann (offen bzw. abgeschlossen, ohne Konflikt mit den übrigen Zielen) */
const optionsFor = (type: ItemType, target: StatusTarget) =>
  targetOptions(session.statusesOf(type), targetDraft.value[type], target);

/** Ziele eines Typs sofort speichern */
async function saveTargets(type: ItemType) {
  const t = targetDraft.value[type];
  try {
    session.statusTargets = await api.put<StatusTargetsByType>('/statuses/targets', {
      type,
      targets: { start: t.start, reply: t.reply, close: t.close, reject: t.reject || null, waiting: t.waiting || null },
    });
  } catch (err) {
    toast.error(err);
  }
  syncTargets();
}

const targetFieldId = (type: ItemType, target: StatusTarget) => `target-${type}-${target}`;

/** Zum Feld eines Ziels im Block «Automatische Wechsel» springen (Schilder und Marken im Diagramm) */
function jumpTo(type: ItemType, target: StatusTarget) {
  const field = document.getElementById(targetFieldId(type, target));
  if (!field) return;
  field.scrollIntoView({ behavior: 'smooth', block: 'center' });
  field.focus({ preventScroll: true });
}

/** Ablauf eines Typs speichern: eingeschränkt ja/nein und die erlaubten Wechsel */
async function saveFlow(type: ItemType, restrict: boolean, transitions: StatusFlow['transitions']) {
  try {
    session.statusFlow = await api.put<StatusFlow>('/statuses/flow', { type, restrict, transitions });
  } catch (err) {
    toast.error(err);
    await load();
  }
}

const transitionsOf = (type: ItemType) => {
  const ids = new Set(session.statusesOf(type).map((s) => s.id));
  return session.statusFlow.transitions.filter((t) => ids.has(t.fromId));
};

/** Lage im Diagramm merken, ohne alles neu zu laden */
async function moveNode(id: string, x: number, y: number) {
  const status = session.statuses.find((s) => s.id === id);
  if (status) Object.assign(status, { diagramX: x, diagramY: y });
  try {
    await api.patch(`/statuses/${id}`, { diagramX: x, diagramY: y });
  } catch (err) {
    toast.error(err);
  }
}

/* Löschen: Ersatz für die Vorgänge und für jedes Ziel, das auf den Status zeigt */

/** Wahl «keiner» bei freiwilligen Zielen; '' = noch nicht gewählt */
const NONE = 'none';
const removing = ref<Status | null>(null);
const replacementId = ref('');
const choices = ref<Partial<Record<StatusTarget, string>>>({});
/** Von Hand gewählte Ziele werden beim Wechsel des Ersatzstatus nicht mehr vorbelegt */
const touched = ref<Partial<Record<StatusTarget, boolean>>>({});
/** Zeitgesteuerte Regeln, die den Status nennen */
const ruleNames = ref<string[]>([]);
const removeError = ref('');

const removeUsage = computed(() => (removing.value ? (usage.value[removing.value.id] ?? 0) : 0));
const removeOthers = computed(() =>
  removing.value ? session.statusesOf(removing.value.type).filter((s) => s.id !== removing.value!.id) : [],
);
const removeTargets = computed(() =>
  removing.value ? targetsOf(session.statusTargets[removing.value.type], removing.value.id) : [],
);
const replacement = computed(() => removeOthers.value.find((s) => s.id === replacementId.value));

const choiceIds = () =>
  Object.fromEntries(removeTargets.value.map((t) => [t, choices.value[t] === NONE ? null : choices.value[t]])) as Partial<
    Record<StatusTarget, string | null>
  >;

/** Passende Status für ein Ziel des gelöschten Status, nach den übrigen Zielen samt bisheriger Wahl */
function removalOptions(target: StatusTarget): Status[] {
  const status = removing.value;
  if (!status) return [];
  return targetOptions(removeOthers.value, targetsAfterRemoval(session.statusTargets[status.type], status.id, choiceIds()), target);
}

const canRemove = computed(
  () =>
    !!removing.value &&
    (removeUsage.value === 0 || !!replacement.value) &&
    removeTargets.value.every((t) => !!choices.value[t]),
);

async function askRemove(status: Status) {
  removing.value = status;
  replacementId.value = '';
  choices.value = Object.fromEntries(removeTargets.value.map((t) => [t, '']));
  touched.value = {};
  ruleNames.value = [];
  removeError.value = '';
  try {
    // Anzahl Vorgänge frisch laden, sonst fehlt bei inzwischen verwendeten Status die Wahl des Ersatzes
    const [counts, rulesUsage] = await Promise.all([
      api.get<Record<string, number>>('/statuses/usage'),
      api.get<Record<string, string[]>>('/statuses/rules-usage'),
    ]);
    usage.value = counts;
    ruleNames.value = rulesUsage[status.id] ?? [];
  } catch (err) {
    removeError.value = errorMessage(err);
  }
}

/** Ziele mit dem Ersatzstatus vorbelegen, wenn er passt */
watch(replacementId, (id) => {
  for (const t of removeTargets.value) {
    if (touched.value[t]) continue;
    choices.value[t] = id && removalOptions(t).some((s) => s.id === id) ? id : '';
  }
});

async function confirmRemove() {
  const status = removing.value;
  if (!status || !canRemove.value) return;
  try {
    await api.delete(`/statuses/${status.id}`, { replacementId: replacement.value?.id ?? null, targets: choiceIds() });
    removing.value = null;
    toast.success('Status gelöscht');
    await load();
  } catch (err) {
    removeError.value = errorMessage(err);
  }
}
</script>

<template>
  <div class="stack">
    <h1>Status</h1>
    <p class="muted" style="margin: 0">
      Pro Typ die Status in ihrer Reihenfolge; sie gilt für die Spalten des Boards und alle Auswahllisten und lässt sich per
      Ziehen ändern. «Abgeschlossen» bestimmt Abschlussdatum, Listen offen/abgeschlossen, Board und Portal. Darunter die
      automatischen Wechsel, rechts der Ablauf: welche Wechsel von Hand erlaubt sind.
    </p>
    <div v-for="type in types" :key="type" class="card card-body type-card">
      <h2>{{ TYPE_LABELS[type] }}</h2>
      <div class="type-grid">
        <div class="stack">
          <section class="block">
            <div class="status-row list-head faint" aria-hidden="true">
              <span />
              <span />
              <span>Name</span>
              <span class="center">abgeschlossen</span>
              <span class="right">Vorgänge</span>
              <span />
            </div>
            <draggable v-model="lists[type]" item-key="id" handle=".handle" class="list" :animation="120" @change="onReorder(type)">
              <template #item="{ element }">
                <div class="status-row">
                  <span class="handle" title="Ziehen zum Sortieren">⋮⋮</span>
                  <StatusColorPicker :model-value="element.color" @update:model-value="setColor(element, $event)" />
                  <span class="name-cell">
                    <input
                      class="input label-input"
                      :value="element.label"
                      maxlength="60"
                      :aria-label="`Name von ${element.label}`"
                      @change="rename(element, $event)"
                    />
                    <button
                      v-for="t in targetsOf(session.statusTargets[type], element.id)"
                      :key="t"
                      type="button"
                      class="badge target-badge"
                      :title="TARGET_LABELS[t]"
                      @click="jumpTo(type, t)"
                    >
                      {{ TARGET_SHORT[t] }}
                    </button>
                  </span>
                  <span class="center" :title="closedLock(element)">
                    <input
                      type="checkbox"
                      class="closed-box"
                      :checked="element.closed"
                      :disabled="!!closedLock(element)"
                      :title="closedLock(element)"
                      :aria-label="`${element.label} abgeschlossen`"
                      @change="setClosed(element, $event)"
                    />
                  </span>
                  <span class="right faint usage" title="Vorgänge mit diesem Status">{{ usage[element.id] ?? 0 }}</span>
                  <button class="btn btn-sm btn-ghost btn-danger" type="button" :aria-label="`${element.label} löschen`" @click="askRemove(element)">
                    ✕
                  </button>
                </div>
              </template>
            </draggable>
            <form class="status-row add-row" @submit.prevent="add(type)">
              <span />
              <span />
              <input v-model="newLabel[type]" class="input label-input" placeholder="Status hinzufügen" maxlength="60" aria-label="Neuer Status" />
              <span class="center">
                <input v-model="newClosed[type]" type="checkbox" class="closed-box" title="abgeschlossen" aria-label="Neuer Status abgeschlossen" />
              </span>
              <span />
              <button class="btn btn-sm" type="submit" :disabled="!newLabel[type].trim()" aria-label="Status hinzufügen">+</button>
            </form>
          </section>

          <section class="block">
            <h3>Automatische Wechsel</h3>
            <div v-for="t in STATUS_TARGETS" :key="t" class="field">
              <label :for="targetFieldId(type, t)">
                {{ TARGET_LABELS[t] }}<span v-if="isRequired(t)" class="required" title="Pflicht"> *</span>
              </label>
              <select :id="targetFieldId(type, t)" v-model="targetDraft[type][t]" class="select" @change="saveTargets(type)">
                <option v-if="!isRequired(t)" value="">{{ noneLabel(t) }}</option>
                <option v-for="s in optionsFor(type, t)" :key="s.id" :value="s.id">{{ s.label }}</option>
              </select>
              <span class="hint">{{ TARGET_HINTS[t] }}</span>
            </div>
          </section>
        </div>

        <div class="flow-col">
          <label class="checkbox">
            <input
              type="checkbox"
              :checked="session.statusFlow.restrict[type]"
              @change="saveFlow(type, ($event.target as HTMLInputElement).checked, transitionsOf(type))"
            />
            Wechsel von Hand nur gemäss Ablauf
          </label>
          <span class="faint hint">
            {{
              session.statusFlow.restrict[type]
                ? 'Im Status-Feld und auf dem Board sind nur die Wechsel entlang der Pfeile möglich, «Ablehnen» nur aus Status mit einem Pfeil in den Ablehnen-Status.'
                : 'Zurzeit ist jeder Wechsel erlaubt. Die Pfeile gelten erst, wenn dieses Häkchen gesetzt ist; Pfeile in den Ablehnen-Status bestimmen dann, aus welchen Status «Ablehnen» möglich ist.'
            }}
            Die übrigen automatischen Wechsel (Antworten, Regeln, Typwechsel, Duplikate) gehen immer. Pfeil ziehen: vom Punkt
            rechts an einem Status auf einen anderen; löschen: anklicken und Entf drücken oder doppelklicken. Ein Klick auf eine
            Marke springt zum Feld unter «Automatische Wechsel».
          </span>
          <StatusFlowDiagram
            class="diagram"
            :statuses="session.statusesOf(type)"
            :transitions="transitionsOf(type)"
            :restricted="session.statusFlow.restrict[type]"
            :targets="session.statusTargets[type]"
            @transitions="saveFlow(type, session.statusFlow.restrict[type], $event)"
            @move="moveNode"
            @target="jumpTo(type, $event)"
          />
        </div>
      </div>
    </div>

    <ModalDialog v-if="removing" :title="`Status «${removing.label}» löschen`" @close="removing = null">
      <div v-if="removeUsage > 0" class="field">
        <label for="remove-replacement">
          {{
            removeUsage === 1
              ? '1 Vorgang hat diesen Status. Welchen Status soll er stattdessen erhalten?'
              : `${removeUsage} Vorgänge haben diesen Status. Welchen Status sollen sie stattdessen erhalten?`
          }}
        </label>
        <select id="remove-replacement" v-model="replacementId" class="select">
          <option value="" disabled>Ersatzstatus wählen</option>
          <option v-for="s in removeOthers" :key="s.id" :value="s.id">{{ s.label }}{{ s.closed ? ' (abgeschlossen)' : '' }}</option>
        </select>
      </div>
      <p v-else style="margin: 0">Der Status wird von keinem Vorgang verwendet.</p>

      <div v-for="t in removeTargets" :key="t" class="field">
        <label :for="`remove-target-${t}`">
          «{{ removing.label }}» ist «{{ TARGET_LABELS[t] }}». Welcher Status soll es stattdessen sein?
        </label>
        <select :id="`remove-target-${t}`" v-model="choices[t]" class="select" @change="touched[t] = true">
          <option value="" disabled>Status wählen</option>
          <option v-if="!isRequired(t)" :value="NONE">{{ noneLabel(t) }}</option>
          <option v-for="s in removalOptions(t)" :key="s.id" :value="s.id">{{ s.label }}</option>
        </select>
        <span v-if="isRequired(t) && removalOptions(t).length === 0" class="hint">
          Zuerst einen weiteren {{ TARGET_CLOSED[t] ? 'abgeschlossenen' : 'offenen' }} Status anlegen.
        </span>
      </div>

      <div v-if="ruleNames.length" class="rules-note">
        <span v-for="(name, i) in ruleNames" :key="i">
          Zeitgesteuerte Regel «{{ name }}»: wird angepasst –
          {{
            replacement && !replacement.closed
              ? `«${replacement.label}» ersetzt den Status.`
              : 'der Status wird entfernt.'
          }}
        </span>
        <span v-if="!replacement || replacement.closed" class="faint">
          Eine Regel, die danach weder einen Status noch «Wartet auf den Melder» nennt, wird ausgeschaltet.
        </span>
      </div>

      <div v-if="removeError" class="error-box">{{ removeError }}</div>
      <template #footer>
        <button class="btn" type="button" @click="removing = null">Abbrechen</button>
        <button class="btn btn-danger" type="button" :disabled="!canRemove" @click="confirmRemove">Löschen</button>
      </template>
    </ModalDialog>
  </div>
</template>

<style scoped>
.type-card {
  display: flex;
  flex-direction: column;
  gap: 12px;
}
/* Links die Status und die automatischen Wechsel, rechts das Ablaufdiagramm; schmal untereinander */
.type-grid {
  display: grid;
  grid-template-columns: minmax(400px, 520px) 1fr;
  gap: 20px;
  align-items: start;
}
@media (max-width: 1000px) {
  .type-grid {
    grid-template-columns: 1fr;
  }
}
.flow-col {
  display: flex;
  flex-direction: column;
  gap: 6px;
  min-width: 0;
}
.flow-col .hint {
  font-size: 12px;
}
.diagram {
  height: 480px;
}
.block {
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.block + .block {
  padding-top: 12px;
  border-top: 1px solid var(--border);
}
.block h3 {
  margin-bottom: 2px;
}
.block .field + .field {
  margin-top: 4px;
}
.required {
  color: var(--danger);
}
.hint {
  margin: 0;
  font-size: 12px;
}
.list {
  display: flex;
  flex-direction: column;
  gap: 6px;
}
/* Zeile: Griff, Farbe, Name mit Ziel-Schildern, abgeschlossen, Anzahl Vorgänge, Löschen */
.status-row {
  display: grid;
  grid-template-columns: 16px 22px minmax(0, 1fr) 88px 56px 26px;
  align-items: center;
  gap: 8px;
}
.list-head {
  font-size: 12px;
}
.center {
  display: flex;
  justify-content: center;
}
.right {
  text-align: right;
}
.handle {
  cursor: grab;
  color: var(--text-faint);
  user-select: none;
}
.name-cell {
  display: flex;
  align-items: center;
  gap: 4px;
  min-width: 0;
}
.label-input {
  flex: 1;
  min-width: 0;
}
.target-badge {
  flex-shrink: 0;
  border: 1px solid var(--border);
  font: inherit;
  font-size: 11px;
  cursor: pointer;
}
.target-badge:hover {
  border-color: var(--accent);
  color: var(--accent);
}
.closed-box {
  width: 15px;
  height: 15px;
  margin: 0;
  accent-color: var(--accent);
}
.closed-box:disabled {
  cursor: not-allowed;
}
.usage {
  font-size: 12px;
}
.rules-note {
  display: flex;
  flex-direction: column;
  gap: 4px;
  padding: 10px 12px;
  border-radius: var(--radius-sm);
  background: var(--warning-soft);
}
</style>
