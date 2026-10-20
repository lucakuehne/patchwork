<script setup lang="ts">
import { computed, ref } from 'vue';
import { api, errorMessage } from '../api';
import { fillSnippet } from '../snippets';
import { useSession } from '../stores/session';
import type { ItemDetail, Snippet } from '../types';
import FilePicker from './FilePicker.vue';
import MarkdownEditor from './MarkdownEditor.vue';
import SnippetPicker from './SnippetPicker.vue';

const props = defineProps<{ item: ItemDetail; currentUserId: string }>();
const emit = defineEmits<{ sent: [] }>();

const kind = ref<'reply' | 'note'>('reply');
const body = ref('');
const files = ref<File[]>([]);
const sending = ref(false);
const uploading = ref(false);
const error = ref('');
const session = useSession();
const editor = ref<InstanceType<typeof MarkdownEditor> | null>(null);

/** Textbaustein mit ersetzten Platzhaltern an der Cursorposition einfügen */
function insertSnippet(snippet: Snippet) {
  editor.value?.insertMarkdown(
    fillSnippet(snippet.body, {
      reporter: props.item.reporter.name,
      number: props.item.number,
      title: props.item.title,
      editor: session.user?.name ?? '',
    }),
  );
}

const recipients = computed(() => {
  const to = props.item.reporter.id !== props.currentUserId ? [props.item.reporter] : [];
  const cc = props.item.participants.filter((p) => p.id !== props.currentUserId && p.id !== props.item.reporter.id);
  return { to, cc };
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
    for (const f of files.value) form.append('files', f, f.name);
    await api.post(`/items/${props.item.number}/entries`, form);
    body.value = '';
    files.value = [];
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
        <button type="button" :class="{ active: kind === 'reply' }" @click="kind = 'reply'">Öffentliche Antwort</button>
        <button type="button" :class="{ active: kind === 'note' }" @click="kind = 'note'">Interne Notiz</button>
      </div>
      <span v-if="kind === 'reply'" class="faint small">
        <template v-if="recipients.to.length || recipients.cc.length">
          Per Mail an
          <template v-if="recipients.to.length">{{ recipients.to.map((u) => u.name).join(', ') }}</template>
          <template v-if="recipients.cc.length">
            {{ recipients.to.length ? ', CC: ' : '' }}{{ recipients.cc.map((u) => u.name).join(', ') }}
          </template>
        </template>
        <template v-else>Kein Mail-Empfänger (du bist selbst Melder)</template>
        <strong v-if="session.info?.testMode" class="test-mode">
          · Testbetrieb:
          {{
            session.info.delivery.staff === 'none' && session.info.delivery.others === 'none'
              ? 'wird nicht versendet'
              : 'geht nur an freigegebene Empfänger'
          }}
        </strong>
      </span>
      <span v-else class="faint small">Nur für die IT sichtbar, keine Mail</span>
    </div>
    <MarkdownEditor
      ref="editor"
      v-model="body"
      v-model:uploading="uploading"
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
