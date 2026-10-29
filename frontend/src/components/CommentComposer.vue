<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { api, errorMessage } from '../api';
import { itemRef } from '../item-ref';
import { fillSnippet } from '../snippets';
import { useSession } from '../stores/session';
import { deliveryBlock, isBlockLive } from '../test-mode';
import type { ItemDetail, Snippet } from '../types';
import FilePicker from './FilePicker.vue';
import KindIcon from './KindIcon.vue';
import MarkdownEditor from './MarkdownEditor.vue';
import SnippetPicker from './SnippetPicker.vue';

const props = defineProps<{ item: ItemDetail; currentUserId: string }>();
const emit = defineEmits<{ sent: [] }>();

// Vorgabe: Aufgaben «Intern», Störungen und Eingang «Öffentlich»
const defaultKind = (): 'reply' | 'note' => (props.item.type === 'task' ? 'note' : 'reply');
const kind = ref<'reply' | 'note'>(defaultKind());
const body = ref('');
/** Nur Admins: im Namen dieser Person schreiben ('' = ich selbst, Entscheid vom 28.10.2026) */
const asUserId = ref('');
// Anderer Vorgang: wieder die Vorgabe; Typwechsel nur, solange noch nichts geschrieben ist
watch([() => props.item.id, () => props.item.type], ([id], [oldId]) => {
  if (id !== oldId || !body.value.trim()) kind.value = defaultKind();
  if (id !== oldId) asUserId.value = '';
});
const files = ref<File[]>([]);
const sending = ref(false);
const uploading = ref(false);
const error = ref('');
const session = useSession();
const editor = ref<InstanceType<typeof MarkdownEditor> | null>(null);

/** Zur Auswahl «Als»: aktive IT-Mitarbeitende und Admins ausser mir */
const otherStaff = computed(() => session.staff.filter((u) => u.id !== props.currentUserId));
/** Wer als Autor gilt: die gewählte Person oder ich */
const author = computed(() => session.staff.find((u) => u.id === asUserId.value) ?? session.user);
const authorId = computed(() => author.value?.id ?? props.currentUserId);

/** Textbaustein mit ersetzten Platzhaltern an der Cursorposition einfügen; Bearbeiter = der Autor */
function insertSnippet(snippet: Snippet) {
  editor.value?.insertMarkdown(
    fillSnippet(snippet.body, {
      prefix: props.item.prefix,
      number: props.item.number,
      title: props.item.title,
      reporter: props.item.reporter,
      assignee: props.item.assignee,
      editor: author.value,
    }),
  );
}

const recipients = computed(() => {
  const to = props.item.reporter.id !== authorId.value ? [props.item.reporter] : [];
  const cc = props.item.participants.filter((p) => p.id !== authorId.value && p.id !== props.item.reporter.id);
  return { to, cc };
});

/** Testbetrieb nach dem Block des Vorgangs: null = normal versendet */
const testModeNote = computed(() => {
  const circles = session.info?.delivery[deliveryBlock(props.item.type)];
  if (!circles || isBlockLive(circles)) return null;
  return circles.staff === 'none' && circles.others === 'none' ? 'wird nicht versendet' : 'geht nur an freigegebene Empfänger';
});

const canSend = computed(() => !sending.value && !uploading.value && (!!body.value.trim() || files.value.length > 0));

async function send() {
  if (!canSend.value) return;
  sending.value = true;
  error.value = '';
  try {
    const form = new FormData();
    form.append('kind', kind.value);
    form.append('body', body.value);
    if (asUserId.value) form.append('asUserId', asUserId.value);
    for (const f of files.value) form.append('files', f, f.name);
    await api.post(`/items/${itemRef(props.item)}/entries`, form);
    body.value = '';
    files.value = [];
    asUserId.value = '';
    emit('sent');
  } catch (err) {
    error.value = errorMessage(err);
  } finally {
    sending.value = false;
  }
}
</script>

<template>
  <div class="composer card" :class="kind">
    <div class="composer-head">
      <div class="segmented">
        <button type="button" :class="{ active: kind === 'reply' }" title="Öffentliche Antwort an den Melder" @click="kind = 'reply'">
          <KindIcon kind="public" /> Öffentlich
        </button>
        <button type="button" :class="{ active: kind === 'note' }" title="Interne Notiz, nur für die IT" @click="kind = 'note'">
          <KindIcon kind="internal" /> Intern
        </button>
      </div>
      <span v-if="kind === 'reply'" class="faint small">
        <template v-if="recipients.to.length || recipients.cc.length">
          Per Mail an
          <template v-if="recipients.to.length">{{ recipients.to.map((u) => u.name).join(', ') }}</template>
          <template v-if="recipients.cc.length">
            {{ recipients.to.length ? ', CC: ' : '' }}{{ recipients.cc.map((u) => u.name).join(', ') }}
          </template>
        </template>
        <template v-else-if="asUserId">Kein Mail-Empfänger ({{ author?.name }} ist selbst Melder)</template>
        <template v-else>Kein Mail-Empfänger (du bist selbst Melder)</template>
        <strong v-if="testModeNote" class="test-mode"> · Testbetrieb: {{ testModeNote }} </strong>
      </span>
      <span v-else class="faint small">Nur für die IT sichtbar, keine Mail</span>
    </div>
    <MarkdownEditor
      ref="editor"
      v-model="body"
      v-model:uploading="uploading"
      mentions
      :min-height="110"
      :placeholder="kind === 'reply' ? 'Antwort an den Melder …' : 'Interne Notiz …'"
      @submit="send"
    />
    <div class="tools">
      <FilePicker v-model="files" compact />
      <SnippetPicker @pick="insertSnippet" />
    </div>
    <div v-if="error" class="error-box">{{ error }}</div>
    <div class="row">
      <span class="faint small">Ctrl+Enter sendet</span>
      <div class="spacer" />
      <label v-if="session.isAdmin && otherStaff.length" class="as-user small">
        Als
        <select v-model="asUserId" class="select" aria-label="Im Namen von">
          <option value="">{{ session.user?.name }} (ich)</option>
          <option v-for="u in otherStaff" :key="u.id" :value="u.id">{{ u.name }}</option>
        </select>
      </label>
      <button class="btn" :class="kind === 'reply' ? 'btn-primary' : 'btn-note'" type="button" :disabled="!canSend" @click="send">
        {{ kind === 'reply' ? 'Antwort senden' : 'Notiz speichern' }}
      </button>
    </div>
  </div>
</template>

<style scoped>
.composer {
  padding: 12px;
  display: flex;
  flex-direction: column;
  gap: 10px;
}
/* Öffentliche Antwort blau, interne Notiz orange wie in der Timeline; Umschalter und Knopf in derselben Farbe */
.composer.reply {
  background: var(--reply-bg);
  border-color: var(--reply-border);
  border-left: 3px solid var(--reply-accent);
}
.composer.note {
  background: var(--note-bg);
  border-color: var(--note-border);
  border-left: 3px solid var(--note-accent);
}
.composer.note .segmented .active {
  background: var(--note-soft);
  color: var(--note-text);
}
.composer-head {
  display: flex;
  align-items: center;
  gap: 12px;
  flex-wrap: wrap;
}
.small {
  font-size: 12px;
}
.test-mode {
  color: var(--warning);
  font-weight: 500;
}
.as-user {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  color: var(--text-muted);
}
.as-user .select {
  width: auto;
  max-width: 220px;
}
.tools {
  display: flex;
  align-items: flex-start;
  gap: 10px;
  flex-wrap: wrap;
}
.tools > :first-child {
  flex: 1;
  min-width: 0;
}
</style>
