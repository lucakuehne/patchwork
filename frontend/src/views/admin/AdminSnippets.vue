<script setup lang="ts">
import { onMounted, ref } from 'vue';
import { api, errorMessage } from '../../api';
import MarkdownEditor from '../../components/MarkdownEditor.vue';
import ModalDialog from '../../components/ModalDialog.vue';
import { renderMarkdown } from '../../markdown';
import { SNIPPET_PLACEHOLDERS } from '../../snippets';
import { useConfirm } from '../../stores/confirm';
import { useToast } from '../../stores/toast';
import type { Snippet } from '../../types';

const toast = useToast();
const confirm = useConfirm();
const snippets = ref<Snippet[]>([]);
const draft = ref<{ id: string | null; name: string; body: string } | null>(null);
const editor = ref<InstanceType<typeof MarkdownEditor> | null>(null);
const error = ref('');
const saving = ref(false);

async function load() {
  try {
    snippets.value = await api.get<Snippet[]>('/snippets');
  } catch (err) {
    toast.error(err);
  }
}
onMounted(load);

function create() {
  error.value = '';
  draft.value = { id: null, name: '', body: '' };
}

function edit(s: Snippet) {
  error.value = '';
  draft.value = { id: s.id, name: s.name, body: s.body };
}

async function save() {
  const d = draft.value;
  if (!d) return;
  saving.value = true;
  error.value = '';
  try {
    if (d.id) await api.put(`/admin/snippets/${d.id}`, { name: d.name, body: d.body });
    else await api.post('/admin/snippets', { name: d.name, body: d.body });
    draft.value = null;
    toast.success('Textbaustein gespeichert');
    await load();
  } catch (err) {
    error.value = errorMessage(err);
  } finally {
    saving.value = false;
  }
}

async function remove(s: Snippet) {
  const ok = await confirm.ask({
    title: 'Textbaustein löschen',
    message: `Textbaustein «${s.name}» löschen?`,
    confirmLabel: 'Löschen',
    danger: true,
  });
  if (!ok) return;
  try {
    await api.delete(`/admin/snippets/${s.id}`);
    await load();
  } catch (err) {
    toast.error(err);
  }
}
</script>

<template>
  <div class="stack">
    <div class="page-head" style="margin: 0">
      <h1>Textbausteine</h1>
      <div class="spacer" />
      <button class="btn btn-primary" type="button" @click="create">+ Textbaustein</button>
    </div>
    <p class="muted" style="margin: 0">
      Vorlagen für Antworten und Notizen, z.B. «Passwort zurückgesetzt». Im Antwortfeld über «Textbaustein» einfügen. Platzhalter
      werden dabei ersetzt:
      <template v-for="(p, i) in SNIPPET_PLACEHOLDERS" :key="p.key">
        <code v-text="p.token" /> ({{ p.label }}){{ i < SNIPPET_PLACEHOLDERS.length - 1 ? ', ' : '.' }}
      </template>
    </p>

    <div v-if="!snippets.length" class="card empty">Noch keine Textbausteine.</div>
    <div v-for="s in snippets" :key="s.id" class="card card-body snippet">
      <div class="row">
        <h2>{{ s.name }}</h2>
        <div class="spacer" />
        <button class="btn btn-sm" type="button" @click="edit(s)">Bearbeiten</button>
        <button class="btn btn-sm btn-danger" type="button" @click="remove(s)">Löschen</button>
      </div>
      <div class="prose preview" v-html="renderMarkdown(s.body)" />
    </div>

    <ModalDialog v-if="draft" wide :title="draft.id ? 'Textbaustein bearbeiten' : 'Neuer Textbaustein'" @close="draft = null">
      <div class="field">
        <label for="snippet-name">Name</label>
        <input id="snippet-name" v-model="draft.name" class="input" maxlength="200" placeholder="z.B. Passwort zurückgesetzt" autofocus />
      </div>
      <div class="field">
        <span class="label">Text</span>
        <MarkdownEditor
          ref="editor"
          v-model="draft.body"
          :images="false"
          :min-height="180"
          placeholder="Guten Tag {{Melder}} …"
          @submit="save"
        />
        <div class="placeholders">
          <span class="hint">Platzhalter einfügen:</span>
          <button
            v-for="p in SNIPPET_PLACEHOLDERS"
            :key="p.key"
            class="btn btn-sm"
            type="button"
            :title="`${p.token}: ${p.label}`"
            @click="editor?.insertText(p.token)"
          >
            {{ p.key }}
          </button>
        </div>
      </div>
      <div v-if="error" class="error-box">{{ error }}</div>
      <template #footer>
        <button class="btn" type="button" @click="draft = null">Abbrechen</button>
        <button class="btn btn-primary" type="button" :disabled="saving" @click="save">Speichern</button>
      </template>
    </ModalDialog>
  </div>
</template>

<style scoped>
.snippet {
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.preview {
  color: var(--text-muted);
}
.placeholders {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 6px;
}
</style>
