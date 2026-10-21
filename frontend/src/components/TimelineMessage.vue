<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue';
import { api, errorMessage } from '../api';
import { formatDateTime, itemRef } from '../format';
import { renderMailHtml, renderMarkdown } from '../markdown';
import { deliveryMark } from '../outgoing';
import { useSession } from '../stores/session';
import { NOTE_EDIT_MINUTES } from '../timeline';
import type { Entry } from '../types';
import AttachmentList from './AttachmentList.vue';
import MarkdownEditor from './MarkdownEditor.vue';
import OriginalMailDialog from './OriginalMailDialog.vue';
import SentMailDialog from './SentMailDialog.vue';
import TimelineHead from './TimelineHead.vue';

/** Öffentliche Antwort oder interne Notiz in der Timeline. Eigene Notizen lassen sich kurz nach dem Erfassen bearbeiten. */
const props = defineProps<{ entry: Entry; itemNumber: number }>();
const emit = defineEmits<{ changed: [] }>();
const session = useSession();

const meta = computed(() => (props.entry.meta ?? {}) as Record<string, unknown>);
const author = computed(() => props.entry.author?.name ?? 'System');
const fromMail = computed(() => meta.value.source === 'mail');
// Versand der Antwort, nur bei Abweichungen: Testbetrieb, Fehler, noch unterwegs
const deliveryBadge = computed(() => (props.entry.delivery ? deliveryMark(props.entry.delivery) : null));

const html = computed(() => {
  if (props.entry.bodyHtml) return renderMailHtml(props.entry.bodyHtml);
  return renderMarkdown(props.entry.body);
});

// Art des Eintrags: «Öffentlich» oder «Intern», dahinter, woher er kommt
const label = computed(() => {
  if (props.entry.kind === 'note') {
    if (meta.value.external) return 'Intern · Mail von nicht beteiligter Person';
    return fromMail.value ? 'Intern · per Mail' : 'Intern';
  }
  if (meta.value.automated) return 'Öffentlich · automatische Mail';
  if (meta.value.source === 'merge') {
    return `Öffentlich · zusammengeführt aus ${itemRef(Number(meta.value.mergedFrom))} «${String(meta.value.mergedTitle ?? '')}»`;
  }
  if (meta.value.source === 'portal') return 'Öffentlich · im Portal';
  return fromMail.value ? 'Öffentlich · per Mail' : 'Öffentlich';
});

// Eigene, in Patchwork erfasste Notiz: «Bearbeiten» nur in den ersten Minuten
const ownNote = computed(
  () => props.entry.kind === 'note' && !meta.value.source && !!session.user && props.entry.author?.id === session.user.id,
);
const editDeadline = computed(() => new Date(props.entry.createdAt).getTime() + NOTE_EDIT_MINUTES * 60_000);
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
      :system="!entry.author"
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
        <button v-if="entry.originalMessageId" class="link-btn small" type="button" @click="showOriginal = true">
          Originalmail
        </button>
        <button v-if="entry.mailId" class="link-btn small" type="button" @click="showSent = true">Mail ansehen</button>
      </template>
      <template #after-time>
        <span v-if="entry.editedAt" class="faint small" :title="`Bearbeitet am ${formatDateTime(entry.editedAt)}`">· bearbeitet</span>
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
      <AttachmentList :attachments="entry.attachments" :text="entry.body" />
    </template>
    <OriginalMailDialog
      v-if="showOriginal && entry.originalMessageId"
      :number="itemNumber"
      :message-id="entry.originalMessageId"
      @close="showOriginal = false"
    />
    <SentMailDialog
      v-if="showSent && entry.mailId"
      :number="itemNumber"
      :mail-id="entry.mailId"
      :status="entry.delivery?.status ?? 'sent'"
      @close="showSent = false"
    />
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
