<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue';
import { api, errorMessage } from '../api';
import { formatDateTime, itemRef } from '../format';
import { DEFAULT_PREFIX, type ItemKey } from '../item-ref';
import { renderMailHtml, renderMarkdown } from '../markdown';
import { deliveryMark } from '../outgoing';
import { useSession } from '../stores/session';
import { useToast } from '../stores/toast';
import { authorName, NOTE_EDIT_MINUTES } from '../timeline';
import type { Entry } from '../types';
import AttachmentList from './AttachmentList.vue';
import MarkdownEditor from './MarkdownEditor.vue';
import NoteTimeDialog from './NoteTimeDialog.vue';
import OriginalMailDialog from './OriginalMailDialog.vue';
import SentMailDialog from './SentMailDialog.vue';
import TimelineHead from './TimelineHead.vue';

/**
 * Öffentliche Antwort oder interne Notiz in der Timeline. Eigene Notizen lassen sich kurz nach dem Erfassen bearbeiten,
 * Admins können die Zeit interner Notizen anpassen.
 */
const props = defineProps<{ entry: Entry; itemKey: ItemKey }>();
const emit = defineEmits<{ changed: [] }>();
const session = useSession();
const toast = useToast();

const meta = computed(() => (props.entry.meta ?? {}) as Record<string, unknown>);
const author = computed(() => authorName(props.entry) ?? 'System');
const fromMail = computed(() => meta.value.source === 'mail');
// Versand der Antwort, nur bei Abweichungen: Testbetrieb, Fehler, noch unterwegs
const deliveryBadge = computed(() => (props.entry.delivery ? deliveryMark(props.entry.delivery) : null));

const html = computed(() => {
  if (props.entry.bodyHtml) return renderMailHtml(props.entry.bodyHtml);
  return renderMarkdown(props.entry.body);
});

// Art des Eintrags: «Öffentlich» oder «Intern», dahinter, woher er kommt
const label = computed(() => {
  if (meta.value.source === 'helpspot') return props.entry.kind === 'note' ? 'Intern · aus HelpSpot' : 'Öffentlich · aus HelpSpot';
  if (props.entry.kind === 'note') {
    if (meta.value.external) return 'Intern · Mail von nicht beteiligter Person';
    return fromMail.value ? 'Intern · per Mail' : 'Intern';
  }
  if (meta.value.automated) return 'Öffentlich · automatische Mail';
  if (meta.value.source === 'merge') {
    const from = itemRef({ prefix: String(meta.value.mergedFromPrefix ?? DEFAULT_PREFIX), number: Number(meta.value.mergedFrom) });
    // Gesperrter Vorgang (Bereiche je Rolle): nur die Nummer
    if (meta.value.refHidden) return `Öffentlich · zusammengeführt aus ${from}`;
    return `Öffentlich · zusammengeführt aus ${from} «${String(meta.value.mergedTitle ?? '')}»`;
  }
  if (meta.value.source === 'portal') return 'Öffentlich · im Portal';
  return fromMail.value ? 'Öffentlich · per Mail' : 'Öffentlich';
});

// Eigene, in Patchwork erfasste Notiz (auch eine, die ich im Namen eines anderen erfasst habe): «Bearbeiten» nur in den
// ersten Minuten
const ownNote = computed(
  () =>
    props.entry.kind === 'note' &&
    !meta.value.source &&
    !!session.user &&
    (props.entry.author?.id === session.user.id || props.entry.recordedById === session.user.id),
);
// Hat ein Admin die Zeit angepasst, zählt die Frist ab der ursprünglichen Zeit (wie im Backend)
const editDeadline = computed(
  () => new Date(props.entry.timeChange?.originalAt ?? props.entry.createdAt).getTime() + NOTE_EDIT_MINUTES * 60_000,
);
const canEdit = ref(false);
let timer: number | undefined;
watch(
  [ownNote, editDeadline],
  () => {
    window.clearTimeout(timer);
    const remaining = editDeadline.value - Date.now();
    canEdit.value = ownNote.value && remaining > 0;
    if (canEdit.value) timer = window.setTimeout(() => (canEdit.value = false), remaining);
  },
  { immediate: true },
);
onBeforeUnmount(() => window.clearTimeout(timer));

const editing = ref(false);
const draft = ref('');
const saving = ref(false);
const uploading = ref(false);
const error = ref('');
const showOriginal = ref(false);
const showSent = ref(false);

// Zeit einer internen Notiz: Admins können sie jederzeit anpassen (alle Autoren, auch per Mail eingegangene)
const canChangeTime = computed(() => props.entry.kind === 'note' && session.isAdmin);
const showTime = ref(false);
const timeChangeTitle = computed(() => {
  const change = props.entry.timeChange;
  if (!change) return '';
  const by = change.by ? ` von ${change.by}` : '';
  return `Ursprünglich ${formatDateTime(change.originalAt)}; angepasst${by} am ${formatDateTime(change.at)}`;
});
function onTimeSaved() {
  showTime.value = false;
  toast.success('Zeit der Notiz angepasst');
  emit('changed');
}

function startEdit() {
  draft.value = props.entry.body;
  error.value = '';
  editing.value = true;
}

async function save() {
  if (!draft.value.trim()) {
    error.value = 'Der Text ist leer';
    return;
  }
  saving.value = true;
  error.value = '';
  try {
    await api.patch(`/entries/${props.entry.id}`, { body: draft.value });
    editing.value = false;
    emit('changed');
  } catch (err) {
    error.value = errorMessage(err);
  } finally {
    saving.value = false;
  }
}
</script>

<template>
  <div class="message" :class="[entry.kind, { automated: meta.automated }]">
    <TimelineHead
      :name="author"
      :name-title="entry.recordedBy ? `erfasst von ${entry.recordedBy}` : undefined"
      :system="!authorName(entry)"
      :kind="label"
      :icon="entry.kind === 'note' ? 'internal' : 'public'"
      :time="entry.createdAt"
    >
      <template #badges>
        <span v-if="meta.simulated" class="badge simulated" title="Im Testbetrieb simuliert, nicht wirklich per Mail eingegangen">
          simuliert
        </span>
        <span v-if="deliveryBadge" class="badge" :class="deliveryBadge.kind" :title="deliveryBadge.title">{{ deliveryBadge.text }}</span>
      </template>
      <template #actions>
        <button
          v-if="canEdit && !editing"
          class="link-btn small"
          type="button"
          :title="`Möglich bis ${formatDateTime(new Date(editDeadline).toISOString())}`"
          @click="startEdit"
        >
          Bearbeiten
        </button>
        <button v-if="canChangeTime && !editing" class="link-btn small" type="button" @click="showTime = true">Zeit anpassen</button>
        <button v-if="entry.originalMessageId" class="link-btn small" type="button" @click="showOriginal = true">
          Originalmail
        </button>
        <button v-if="entry.mailId" class="link-btn small" type="button" @click="showSent = true">Mail ansehen</button>
      </template>
      <template #after-time>
        <span v-if="entry.editedAt" class="faint small" :title="`Bearbeitet am ${formatDateTime(entry.editedAt)}`">· bearbeitet</span>
        <span v-if="entry.timeChange" class="faint small time-changed" :title="timeChangeTitle">· Zeit angepasst</span>
      </template>
    </TimelineHead>
    <div v-if="editing" class="stack">
      <MarkdownEditor v-model="draft" v-model:uploading="uploading" :min-height="90" autofocus mentions @submit="save" />
      <div v-if="error" class="error-box">{{ error }}</div>
      <div class="row">
        <button class="btn btn-sm btn-note" type="button" :disabled="saving || uploading" @click="save">Speichern</button>
        <button class="btn btn-sm" type="button" :disabled="saving" @click="editing = false">Abbrechen</button>
      </div>
    </div>
    <template v-else>
      <div class="prose msg-body" :class="{ 'mail-html': !!entry.bodyHtml }" v-html="html" />
      <AttachmentList :attachments="entry.attachments" :text="entry.body" :html="entry.bodyHtml" />
    </template>
    <OriginalMailDialog
      v-if="showOriginal && entry.originalMessageId"
      :item-key="itemKey"
      :message-id="entry.originalMessageId"
      @close="showOriginal = false"
      @simulated="emit('changed')"
    />
    <SentMailDialog
      v-if="showSent && entry.mailId"
      :item-key="itemKey"
      :mail-id="entry.mailId"
      :status="entry.delivery?.status ?? 'sent'"
      @close="showSent = false"
    />
    <NoteTimeDialog v-if="showTime" :entry="entry" @close="showTime = false" @saved="onTimeSaved" />
  </div>
</template>

<style scoped>
.message {
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: var(--radius);
  padding: 12px 14px;
}
/* Öffentliche Nachrichten blau, interne Notizen orange */
.message.reply {
  background: var(--reply-bg);
  border-color: var(--reply-border);
  border-left: 3px solid var(--reply-accent);
}
.message.note {
  background: var(--note-bg);
  border-color: var(--note-border);
  border-left: 3px solid var(--note-accent);
}
.message.automated {
  opacity: 0.75;
}
.small {
  font-size: 12px;
}
.badge.held {
  background: var(--warning-soft);
  color: var(--warning);
}
.badge.failed {
  background: var(--danger-soft);
  color: var(--danger);
}
.badge.queued {
  background: var(--surface-2);
  color: var(--text-muted);
}
</style>
