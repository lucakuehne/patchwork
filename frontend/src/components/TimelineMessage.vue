<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue';
import { api, errorMessage } from '../api';
import { formatDateTime, initials, itemRef } from '../format';
import { renderMailHtml, renderMarkdown } from '../markdown';
import { useSession } from '../stores/session';
import { NOTE_EDIT_MINUTES } from '../timeline';
import type { Entry } from '../types';
import AttachmentList from './AttachmentList.vue';
import MarkdownEditor from './MarkdownEditor.vue';

/** Öffentliche Antwort oder interne Notiz in der Timeline. Eigene Notizen lassen sich kurz nach dem Erfassen bearbeiten. */
const props = defineProps<{ entry: Entry; itemNumber: number; reporterId: string }>();
const emit = defineEmits<{ changed: [] }>();
const session = useSession();

const meta = computed(() => (props.entry.meta ?? {}) as Record<string, unknown>);
const author = computed(() => props.entry.author?.name ?? 'System');
const fromMail = computed(() => meta.value.source === 'mail');
// Versand der Antwort, nur bei Abweichungen: Testbetrieb, Fehler, noch unterwegs
const deliveryBadge = computed(() => {
  const d = props.entry.delivery;
  if (!d) return null;
  switch (d.status) {
    case 'partial':
      return {
        text: 'teilweise versendet',
        title: `Im Testbetrieb nur an ${d.deliveredTo.join(', ')} versendet, nicht an ${d.withheld.join(', ')}`,
        kind: 'held',
      };
    case 'held':
      return { text: 'nicht versendet', title: `Im Testbetrieb zusammengestellt, aber nicht versendet (an ${d.withheld.join(', ')})`, kind: 'held' };
    case 'failed':
      return { text: 'Versand fehlgeschlagen', title: d.error ?? '', kind: 'failed' };
    default:
      return { text: 'wird versendet', title: 'Die Mail ist in der Versand-Queue', kind: 'queued' };
  }
});

const html = computed(() => {
  if (props.entry.bodyHtml) return renderMailHtml(props.entry.bodyHtml);
  return renderMarkdown(props.entry.body);
});

const label = computed(() => {
  if (props.entry.kind === 'note') {
    if (meta.value.external) return 'Mail von nicht beteiligter Person · als interne Notiz erfasst';
    return fromMail.value ? 'Mail · interne Notiz' : 'Interne Notiz';
  }
  if (meta.value.automated) return 'Automatische Antwort per Mail';
  if (meta.value.source === 'merge') return `Zusammengeführt aus ${itemRef(Number(meta.value.mergedFrom))} «${String(meta.value.mergedTitle ?? '')}»`;
  if (meta.value.source === 'portal') return 'Antwort des Melders im Portal';
  if (fromMail.value) return props.entry.author?.id === props.reporterId ? 'Antwort des Melders per Mail' : 'Antwort per Mail';
  return 'Öffentliche Antwort';
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
    <div class="msg-head">
      <span class="avatar">{{ initials(author) }}</span>
      <strong>{{ author }}</strong>
      <span class="kind">{{ label }}</span>
      <span class="spacer" />
      <button
        v-if="canEdit && !editing"
        class="edit-btn"
        type="button"
        :title="`Möglich bis ${formatDateTime(new Date(editDeadline).toISOString())}`"
        @click="startEdit"
      >
        Bearbeiten
      </button>
      <a
        v-if="entry.originalMessageId"
        class="faint small"
        :href="`/api/items/${itemNumber}/original?messageId=${encodeURIComponent(entry.originalMessageId)}`"
        title="Originalmail herunterladen"
      >
        Original
      </a>
      <span class="faint small">{{ formatDateTime(entry.createdAt) }}</span>
      <span v-if="entry.editedAt" class="faint small" :title="`Bearbeitet am ${formatDateTime(entry.editedAt)}`">· bearbeitet</span>
      <span v-if="deliveryBadge" class="badge" :class="deliveryBadge.kind" :title="deliveryBadge.title">{{ deliveryBadge.text }}</span>
    </div>
    <div v-if="editing" class="stack">
      <MarkdownEditor v-model="draft" v-model:uploading="uploading" :min-height="90" autofocus @submit="save" />
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
.msg-head {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 8px;
}
.kind {
  font-size: 12px;
  color: var(--text-muted);
}
.small {
  font-size: 12px;
}
.edit-btn {
  border: none;
  background: none;
  padding: 0;
  font: inherit;
  font-size: 12px;
  color: var(--note-text);
  cursor: pointer;
}
.edit-btn:hover {
  text-decoration: underline;
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
