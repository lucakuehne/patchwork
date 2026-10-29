<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue';
import { api, errorMessage } from '../api';
import ChecklistsPanel from '../components/ChecklistsPanel.vue';
import CommentComposer from '../components/CommentComposer.vue';
import ChannelIcon from '../components/ChannelIcon.vue';
import HelpTip from '../components/HelpTip.vue';
import ItemDescription from '../components/ItemDescription.vue';
import LinksPanel from '../components/LinksPanel.vue';
import PersonSearch from '../components/PersonSearch.vue';
import type { ItemKey } from '../item-ref';
import { manualStatusChoices, moveItem } from '../status-move';
import RejectDialog from '../components/RejectDialog.vue';
import StatusBadge from '../components/StatusBadge.vue';
import TimelineEvents from '../components/TimelineEvents.vue';
import TimelineMail from '../components/TimelineMail.vue';
import TimelineMessage from '../components/TimelineMessage.vue';
import TypeChangeDialog from '../components/TypeChangeDialog.vue';
import UserPicker from '../components/UserPicker.vue';
import { dueState, formatDateTime, itemRef, PRIORITY_LABELS, TYPE_HINTS, TYPE_LABELS } from '../format';
import { useSession } from '../stores/session';
import { useToast } from '../stores/toast';
import { groupTimeline, type TimelineBlock } from '../timeline';
import type { ItemDetail, ItemType, PersonPick, Priority, User } from '../types';

/** «embedded»: im Fenster über einer Ansicht (Einstellung «Fenster»), ohne Seitenrand */
/** «itemKey» null: ungültige Kennung in der Adresse (zeigt «nicht gefunden») */
const props = defineProps<{ itemKey: ItemKey | null; embedded?: boolean }>();
/** Kennung für Anzeige und Schnittstelle, z.B. «PW-123» */
const refText = computed(() => (props.itemKey ? itemRef(props.itemKey) : ''));
const session = useSession();
const toast = useToast();

const item = ref<ItemDetail | null>(null);
const notFound = ref(false);
/** Vorgang in einem Bereich ohne Zugriff (Bereiche je Rolle): Meldung des Servers */
const forbidden = ref('');
const busy = ref(false);
const rejectOpen = ref(false);
const editingTitle = ref(false);
const titleDraft = ref('');

// Solange eine Mail «wird versendet», den Vorgang alle 3 Sekunden nachladen, höchstens eine Minute lang
const FOLLOW_MS = 3000;
const FOLLOW_MAX = 20;
let followTimer: number | undefined;
let followUps = 0;
let unmounted = false;
function followSending() {
  window.clearTimeout(followTimer);
  const current = item.value;
  const sending =
    !!current && (current.mails.some((m) => m.status === 'queued') || current.entries.some((e) => e.delivery?.status === 'queued'));
  if (unmounted || !sending || followUps >= FOLLOW_MAX) return;
  followUps++;
  followTimer = window.setTimeout(() => void load(true), FOLLOW_MS);
}
// Nach dem Schliessen (v.a. des Fensters) wieder der Titel der Ansicht darunter
const previousTitle = document.title;
onBeforeUnmount(() => {
  unmounted = true;
  window.clearTimeout(followTimer);
  document.title = previousTitle;
});

/** Laufnummer der Anfragen: Nur die Antwort der neuesten zählt (auch nach dem Wechsel zu einem anderen Vorgang). */
let loadSeq = 0;

/** «background»: Nachladen, solange eine Mail unterwegs ist; Fehler dabei ohne Meldung */
async function load(background = false) {
  const current = refText.value;
  const seq = ++loadSeq;
  window.clearTimeout(followTimer);
  if (!background) followUps = 0;
  if (!current) {
    item.value = null;
    notFound.value = true;
    return;
  }
  try {
    const loaded = await api.get<ItemDetail>(`/items/${current}`, { background });
    if (unmounted || seq !== loadSeq) return;
    item.value = loaded;
    notFound.value = false;
    forbidden.value = '';
    document.title = `${current} ${loaded.title} – ${session.appName}`;
  } catch (err) {
    if (unmounted || seq !== loadSeq) return;
    // Im Hintergrund ohne Meldung; das Nachladen versucht es weiter (begrenzt)
    if (!background) {
      const status = (err as { status?: number }).status;
      if (status === 404) notFound.value = true;
      else if (status === 403) {
        item.value = null;
        forbidden.value = errorMessage(err);
      } else toast.error(err);
    }
  }
  followSending();
}
watch(refText, () => load(), { immediate: true });

/** Führt eine Änderung aus und lädt danach den Vorgang neu. */
async function run(action: () => Promise<unknown>, success?: string) {
  busy.value = true;
  try {
    await action();
    if (success) toast.success(success);
    await load();
    void session.refreshCounts();
  } catch (err) {
    toast.error(err);
    await load();
  } finally {
    busy.value = false;
  }
}

// Nur Status, in die der Vorgang laut Ablauf von Hand wechseln darf (dazu der aktuelle), ohne den Ablehnen-Status
const statusOptions = computed(() => {
  const type = item.value?.type;
  if (!type) return [];
  const current = item.value!.status?.id ?? null;
  return manualStatusChoices(session.statusesOf(type), session.statusTargets[type], current, (toId) =>
    session.canMove(type, current, toId),
  );
});
// Steht der Vorgang im Ablehnen-Status, erscheint dieser im Status-Feld als deaktivierte Option
const inRejectStatus = computed(() => !!item.value?.type && session.isRejectStatus(item.value.status, item.value.type));
const canReject = computed(() => !!item.value?.type && session.canReject(item.value.type, item.value.status?.id ?? null));
// Neueste zuerst; Änderungen kurz hintereinander von derselben Person als eine Zeile, automatische Mails dazwischen
const timeline = computed(() => (item.value ? groupTimeline([...item.value.entries].reverse(), item.value.mails) : []));
const blockKey = (block: TimelineBlock) =>
  block.kind === 'message' ? block.entry.id : block.kind === 'mail' ? block.mail.id : block.entries[0]!.id;
// Fälligkeit (nur Aufgaben): überfällig rot, heute orange
const due = computed(() => (item.value ? dueState(item.value.dueDate, !!item.value.status?.closed) : null));
// Ein Eintrag pro Postfach; ohne eigenes Antwort-Postfach ist das Standard-Postfach gewählt
const mailboxOptions = computed(() => {
  const list = session.mailboxes.map((m) => ({ ...m, inactive: false }));
  const current = item.value?.mailbox;
  if (current && !list.some((m) => m.id === current.id)) list.push({ ...current, isDefault: false, inactive: true });
  return list;
});
const selectedMailboxId = computed(
  () => item.value?.mailbox?.id ?? session.mailboxes.find((m) => m.isDefault)?.id ?? '',
);

// Ein Dialog fragt nach dem Status im neuen Typ: zur Aufgabe immer (ohne Vorauswahl), zur Störung bei einem Vorgang mit
// Status; aus dem Eingang erhält eine Störung den Start-Status
const typeChangeTo = ref<ItemType | null>(null);
function setType(type: ItemType) {
  if (type === 'task' || (item.value?.type && item.value.status)) typeChangeTo.value = type;
  else void run(() => api.post(`/items/${refText.value}/type`, { type }), `Typ ist jetzt «${TYPE_LABELS[type]}»`);
}
function onTypeChanged() {
  const type = typeChangeTo.value;
  typeChangeTo.value = null;
  void run(async () => undefined, type ? `Typ ist jetzt «${TYPE_LABELS[type]}»` : undefined);
}
// Bei offenen Checklisten-Punkten fragt moveItem nach; bei Abbruch wird neu geladen (Auswahl springt zurück)
const setStatus = (statusId: string) => run(() => moveItem(props.itemKey!, { statusId }));
const patch = (body: Record<string, unknown>) => run(() => api.patch(`/items/${refText.value}`, body));
const setDiscarded = (discarded: boolean) =>
  run(() => api.post(`/items/${refText.value}/discard`, { discarded }), discarded ? 'Verworfen' : 'Wiederhergestellt');
const setMuted = (muted: boolean) => run(() => api.put(`/items/${refText.value}/mute`, { muted }));
/** Stummschalten ist vorläufig ausgeblendet und wirkt nicht (Entscheid vom 21.10.2026, Backend: MUTES_ACTIVE) */
const MUTE_OPTION = false;

function setReporter(user: User) {
  void patch({ reporterId: user.id });
}

// Melder und bereits Beteiligte erscheinen in der Suche nicht
const involvedEmails = computed(() =>
  item.value ? [item.value.reporter.email, ...item.value.participants.map((p) => p.email)] : [],
);
const addParticipant = (person: PersonPick) =>
  run(() =>
    api.post(`/items/${refText.value}/participants`, { email: person.email, ...(person.name ? { name: person.name } : {}) }),
  );
const removeParticipant = (user: User) => run(() => api.delete(`/items/${refText.value}/participants/${user.id}`));

function startTitle() {
  titleDraft.value = item.value?.title ?? '';
  editingTitle.value = true;
}
async function saveTitle() {
  editingTitle.value = false;
  if (titleDraft.value.trim() && titleDraft.value.trim() !== item.value?.title) await patch({ title: titleDraft.value });
}
const saveDescription = (description: string) => patch({ description });

function onRejected() {
  rejectOpen.value = false;
  void run(async () => undefined, 'Abgelehnt');
}
</script>

<template>
  <div :class="embedded ? 'embedded' : 'page'">
    <div v-if="notFound" class="empty">Vorgang {{ refText }} wurde nicht gefunden.</div>
    <div v-else-if="forbidden" class="empty">{{ refText }} ist für dich gesperrt: {{ forbidden }}.</div>

    <div v-else-if="item" class="layout">
      <div class="main stack">
        <div class="title-row">
          <span class="mono muted ref">{{ itemRef(item) }}</span>
          <span v-if="item.type" class="badge" :class="`type-${item.type}`">{{ TYPE_LABELS[item.type] }}</span>
          <StatusBadge :status="item.status" />
          <span v-if="item.discarded" class="badge st-red">Verworfen</span>
        </div>
        <div v-if="editingTitle" class="row">
          <input v-model="titleDraft" class="input title-input" maxlength="500" @keydown.enter="saveTitle" @keydown.esc="editingTitle = false" />
          <button class="btn btn-primary" type="button" @click="saveTitle">Speichern</button>
          <button class="btn" type="button" @click="editingTitle = false">Abbrechen</button>
        </div>
        <h1 v-else class="title" title="Klicken zum Bearbeiten" @click="startTitle">{{ item.title }}</h1>
        <!-- Aus HelpSpot übernommen: ursprünglicher Status und Melder laut HelpSpot -->
        <div v-if="item.helpspot" class="helpspot-origin faint">
          Aus HelpSpot übernommen · Status in HelpSpot «{{ item.helpspot.status }}»<template v-if="item.helpspot.reporterName">
            · Melder laut HelpSpot: {{ item.helpspot.reporterName }}</template
          >
        </div>

        <!-- Aufgaben: Beschreibung zuoberst, darunter die Checklisten -->
        <template v-if="item.type === 'task'">
          <ItemDescription :item="item" label="Beschreibung" :busy="busy" :save="saveDescription" @changed="load()" />
          <ChecklistsPanel :item-key="item" :checklists="item.checklists" @changed="load" />
          <!-- Abgrenzung zwischen Aufgabe (Beschreibung, Checklisten) und Antworten mit Verlauf -->
          <div class="section-divider" role="separator"><span>Verlauf</span></div>
        </template>

        <!-- Beim Abmelden ist der Benutzer schon entfernt, bevor die Ansicht verschwindet -->
        <CommentComposer :item="item" :current-user-id="session.user?.id ?? ''" @sent="load" />

        <!-- Neuestes zuoberst; sonst die ursprüngliche Meldung als ältester Eintrag zuunterst -->
        <div class="timeline">
          <template v-for="block in timeline" :key="blockKey(block)">
            <TimelineMessage v-if="block.kind === 'message'" :entry="block.entry" :item-key="item" @changed="load" />
            <TimelineMail v-else-if="block.kind === 'mail'" :mail="block.mail" :item-key="item" />
            <TimelineEvents v-else :entries="block.entries" />
          </template>
        </div>

        <ItemDescription
          v-if="item.type !== 'task'"
          :item="item"
          label="Ursprüngliche Meldung"
          :busy="busy"
          :save="saveDescription"
          @changed="load()"
        />
      </div>

      <aside class="side card card-body">
        <div class="field">
          <span class="label type-label">
            Typ
            <HelpTip label="Was ist eine Störung, was eine Aufgabe?">
              <strong>Störung:</strong> {{ TYPE_HINTS.incident }}.<br />
              <strong>Aufgabe:</strong> {{ TYPE_HINTS.task }}.
            </HelpTip>
          </span>
          <div class="segmented type-switch">
            <!-- Nur in Bereiche, die man selbst sieht (Bereiche je Rolle) -->
            <button
              type="button"
              :class="{ active: item.type === 'incident', suggested: !item.type && item.suggestedType === 'incident' }"
              :disabled="busy || item.type === 'incident' || !session.canSee('incident')"
              :title="session.canSee('incident') ? undefined : 'Kein Zugriff auf den Bereich «Störungen»'"
              @click="setType('incident')"
            >
              Störung
            </button>
            <button
              type="button"
              :class="{ active: item.type === 'task', suggested: !item.type && item.suggestedType === 'task' }"
              :disabled="busy || item.type === 'task' || !session.canSee('task')"
              :title="session.canSee('task') ? undefined : 'Kein Zugriff auf den Bereich «Aufgaben»'"
              @click="setType('task')"
            >
              Aufgabe
            </button>
          </div>
          <span v-if="!item.type && item.suggestedType" class="hint suggestion">
            Vorschlag des Melders: <strong>{{ TYPE_LABELS[item.suggestedType] }}</strong>. Mit einem Klick bestätigen oder den anderen Typ
            wählen.
          </span>
          <span v-else-if="!item.type" class="hint">Liegt im Eingang. Typ wählen, um den Vorgang einzuordnen.</span>
        </div>

        <div v-if="!item.type" class="field">
          <button v-if="!item.discarded" class="btn btn-danger" type="button" :disabled="busy" @click="setDiscarded(true)">
            Verwerfen (Spam, Newsletter)
          </button>
          <button v-else class="btn" type="button" :disabled="busy" @click="setDiscarded(false)">Wiederherstellen</button>
        </div>

        <div v-if="item.type" class="field">
          <label for="item-status">Status</label>
          <select
            id="item-status"
            class="select"
            :value="item.status?.id"
            :disabled="busy"
            @change="setStatus(($event.target as HTMLSelectElement).value)"
          >
            <option v-if="inRejectStatus && item.status" :value="item.status.id" disabled>
              {{ item.status.label }}
            </option>
            <option v-for="s in statusOptions" :key="s.id" :value="s.id">{{ s.label }}</option>
          </select>
          <button v-if="canReject" class="btn btn-sm btn-danger reject" type="button" :disabled="busy" @click="rejectOpen = true">
            Ablehnen …
          </button>
        </div>

        <div class="field">
          <label for="item-priority">Priorität</label>
          <select
            id="item-priority"
            class="select"
            :value="item.priority"
            :disabled="busy"
            @change="patch({ priority: ($event.target as HTMLSelectElement).value as Priority })"
          >
            <option v-for="(label, key) in PRIORITY_LABELS" :key="key" :value="key">{{ label }}</option>
          </select>
        </div>

        <div v-if="item.type === 'task'" class="field">
          <div class="row">
            <label for="item-due" class="label">Fällig am</label>
            <span v-if="due === 'overdue'" class="due-hint overdue">überfällig</span>
            <span v-else-if="due === 'today'" class="due-hint today">heute</span>
          </div>
          <input
            id="item-due"
            class="input"
            :class="due ? `due-${due}` : undefined"
            type="date"
            :value="item.dueDate ?? ''"
            :disabled="busy"
            @change="patch({ dueDate: ($event.target as HTMLInputElement).value || null })"
          />
        </div>

        <div class="field">
          <label for="item-channel">Meldeweg</label>
          <div class="channel-select">
            <ChannelIcon v-if="item.channel" :icon="item.channel.icon" />
            <select
              id="item-channel"
              class="select"
              :value="item.channel?.id ?? ''"
              :disabled="busy"
              @change="patch({ channelId: ($event.target as HTMLSelectElement).value })"
            >
              <option v-if="!item.channel" value="" disabled>– ohne Angabe –</option>
              <option v-for="c in session.channels" :key="c.id" :value="c.id">{{ c.label }}</option>
            </select>
          </div>
        </div>

        <div class="field">
          <div class="row">
            <label for="item-assignee" class="label">Zuständig</label>
            <span class="spacer" />
            <button
              v-if="item.assignee?.id !== session.user?.id"
              class="link-btn"
              type="button"
              :disabled="busy"
              @click="patch({ assigneeId: session.user!.id })"
            >
              Mir zuweisen
            </button>
          </div>
          <select
            id="item-assignee"
            class="select"
            :value="item.assignee?.id ?? ''"
            :disabled="busy"
            @change="patch({ assigneeId: ($event.target as HTMLSelectElement).value || null })"
          >
            <option value="">– niemand –</option>
            <option v-if="item.assignee && !session.staff.some((u) => u.id === item!.assignee!.id)" :value="item.assignee.id">
              {{ item.assignee.name }}
            </option>
            <option v-for="u in session.staff" :key="u.id" :value="u.id">{{ u.name }}</option>
          </select>
        </div>

        <div class="field">
          <span class="label">Melder</span>
          <UserPicker :model-value="item.reporter" @update:model-value="setReporter" />
        </div>

        <div class="field">
          <span class="label">Beteiligte (CC)</span>
          <div v-for="p in item.participants" :key="p.id" class="participant">
            <span :title="p.email">{{ p.name }}</span>
            <span class="faint small ellipsis">{{ p.email }}</span>
            <span class="spacer" />
            <button class="link-btn" type="button" aria-label="Entfernen" :disabled="busy" @click="removeParticipant(p)">✕</button>
          </div>
          <PersonSearch floating placeholder="Person hinzufügen (Name, Benutzername, E-Mail)" :exclude="involvedEmails" @pick="addParticipant" />
        </div>

        <LinksPanel :item-key="item" :links="item.links" @changed="load" />

        <div class="field">
          <label for="item-mailbox">Antwort-Postfach</label>
          <select
            v-if="mailboxOptions.length"
            id="item-mailbox"
            class="select"
            :value="selectedMailboxId"
            :disabled="busy"
            @change="patch({ mailboxId: ($event.target as HTMLSelectElement).value })"
          >
            <option v-for="m in mailboxOptions" :key="m.id" :value="m.id">
              {{ m.name }}{{ m.isDefault ? ' (Standard)' : '' }}{{ m.inactive ? ' (inaktiv, es gilt das Standard-Postfach)' : '' }} · {{ m.address }}
            </option>
          </select>
          <span v-else class="faint small">Kein Postfach eingerichtet</span>
        </div>

        <label v-if="MUTE_OPTION" class="checkbox">
          <input type="checkbox" :checked="item.muted" :disabled="busy" @change="setMuted(($event.target as HTMLInputElement).checked)" />
          Benachrichtigungen für mich stummschalten
        </label>

        <div class="meta faint small">
          <div>Erstellt: {{ formatDateTime(item.createdAt) }}</div>
          <div>Aktualisiert: {{ formatDateTime(item.updatedAt) }}</div>
          <div v-if="item.closedAt">Abgeschlossen: {{ formatDateTime(item.closedAt) }}</div>
        </div>
      </aside>
    </div>

    <RejectDialog v-if="rejectOpen && item" :item-key="item" :title="item.title" @close="rejectOpen = false" @done="onRejected" />
    <TypeChangeDialog
      v-if="typeChangeTo && item"
      :item-key="item"
      :type="item.type"
      :status="item.status"
      :target-type="typeChangeTo"
      @close="typeChangeTo = null"
      @done="onTypeChanged"
    />
  </div>
</template>

<style scoped>
.helpspot-origin {
  font-size: 13px;
  margin-top: -6px;
}
.layout {
  display: grid;
  grid-template-columns: minmax(0, 1fr) 320px;
  gap: 20px;
  align-items: start;
}
.title-row {
  display: flex;
  align-items: center;
  gap: 8px;
}
.ref {
  font-size: 13px;
}
.title {
  cursor: text;
  font-size: 22px;
  overflow-wrap: anywhere;
}
.title-input {
  font-size: 18px;
  height: 38px;
}
.small {
  font-size: 12px;
}
.timeline {
  display: flex;
  flex-direction: column;
  gap: 10px;
}
.section-divider {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-top: 14px;
  font-size: 12px;
  font-weight: 500;
  color: var(--text-faint);
}
.section-divider::before,
.section-divider::after {
  content: '';
  flex: 1;
  height: 1px;
  background: var(--border-strong);
}
.type-label {
  display: flex;
  align-items: center;
  gap: 6px;
}
.side {
  position: sticky;
  /* unter Hinweisbalken und Kopfzeile (useStickyTop); nicht in sich scrollbar, sonst würden Auswahllisten abgeschnitten */
  top: calc(var(--sticky-top, 56px) + 16px);
  display: flex;
  flex-direction: column;
  gap: 16px;
}
/* Im Fenster scrollt der Hintergrund des Fensters, die Kopfzeile liegt nicht darüber */
.embedded .side {
  top: 16px;
}
.type-switch button {
  flex: 1;
  justify-content: center;
}
.type-switch {
  display: flex;
  width: 100%;
}
.type-switch button:disabled {
  cursor: default;
}
/* Vorschlag des Melders aus dem Portal */
.type-switch button.suggested {
  background: var(--accent);
  color: #fff;
}
.hint.suggestion {
  color: var(--text-muted);
}
.reject {
  align-self: flex-start;
  margin-top: 4px;
}
.due-hint {
  margin-left: auto;
  font-size: 12px;
  font-weight: 500;
}
.due-hint.overdue,
.input.due-overdue {
  color: var(--danger);
}
.due-hint.today,
.input.due-today {
  color: var(--warning);
}
.participant {
  display: flex;
  align-items: center;
  gap: 6px;
  min-width: 0;
}
.ellipsis {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.channel-select {
  display: flex;
  align-items: center;
  gap: 8px;
  color: var(--text-muted);
}
.channel-select .select {
  flex: 1;
  min-width: 0;
}
.meta {
  display: flex;
  flex-direction: column;
  gap: 2px;
  border-top: 1px solid var(--border);
  padding-top: 10px;
}
@media (max-width: 960px) {
  .layout {
    grid-template-columns: 1fr;
  }
  .side {
    position: static;
  }
}
</style>
