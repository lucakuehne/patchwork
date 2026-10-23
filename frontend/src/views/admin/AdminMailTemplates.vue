<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { api, errorMessage } from '../../api';
import MarkdownEditor from '../../components/MarkdownEditor.vue';
import { useConfirm } from '../../stores/confirm';
import { useToast } from '../../stores/toast';
import type { MailTemplate } from '../../types';

/**
 * Betreff und Text der Mails, die Patchwork verschickt, mit Platzhaltern und Vorschau. Der Text steht im WYSIWYG-Editor
 * (gespeichert als Markdown), die Fusszeilen als einfacher Text.
 */
const toast = useToast();
const confirm = useConfirm();
const templates = ref<MailTemplate[]>([]);
const currentKey = ref<string | null>(null);
const draft = ref<{ subject: string | null; body: string | null }>({ subject: null, body: null });
const preview = ref<{ subject: string; html: string } | null>(null);
const previewError = ref('');
const saving = ref(false);
const subjectInput = ref<HTMLInputElement | null>(null);
/** Fusszeilen: einfacher Text */
const bodyInput = ref<HTMLTextAreaElement | null>(null);
const bodyEditor = ref<InstanceType<typeof MarkdownEditor> | null>(null);
/** Wohin «Platzhalter einfügen» schreibt: das zuletzt benutzte Feld */
const target = ref<'subject' | 'body'>('body');
let previewTimer: number | undefined;
let previewRequest = 0;

const GROUPS = [
  { key: 'reporter', label: 'An Melder und Beteiligte' },
  { key: 'staff', label: 'An IT-Mitarbeitende' },
] as const;

const current = computed(() => templates.value.find((t) => t.key === currentKey.value) ?? null);
/** Text für den Editor (nur bei Vorlagen mit Text angezeigt) */
const bodyText = computed({
  get: () => draft.value.body ?? '',
  set: (value: string) => (draft.value.body = value),
});
const dirty = computed(
  () => !!current.value && (draft.value.subject !== current.value.subject || draft.value.body !== current.value.body),
);

async function load(selectKey?: string) {
  try {
    templates.value = await api.get<MailTemplate[]>('/admin/mail-templates');
    const key = selectKey ?? currentKey.value ?? templates.value[0]?.key ?? null;
    if (key) openTemplate(key);
  } catch (err) {
    toast.error(err);
  }
}
onMounted(() => load());
onBeforeUnmount(() => window.clearTimeout(previewTimer));

function openTemplate(key: string) {
  const t = templates.value.find((x) => x.key === key);
  if (!t) return;
  currentKey.value = key;
  draft.value = { subject: t.subject, body: t.body };
  target.value = t.body !== null ? 'body' : 'subject';
}

async function select(key: string) {
  if (key === currentKey.value) return;
  if (dirty.value) {
    const ok = await confirm.ask({
      title: 'Änderungen verwerfen',
      message: `Die Änderungen an «${current.value?.label}» sind nicht gespeichert. Verwerfen?`,
      confirmLabel: 'Verwerfen',
      danger: true,
    });
    if (!ok) return;
  }
  openTemplate(key);
}

// Vorschau mit Beispieldaten, kurz nach der letzten Änderung
watch(
  () => [currentKey.value, draft.value.subject, draft.value.body],
  () => {
    window.clearTimeout(previewTimer);
    previewTimer = window.setTimeout(updatePreview, 300);
  },
);

async function updatePreview() {
  const key = currentKey.value;
  if (!key) return;
  const request = ++previewRequest;
  try {
    const result = await api.post<{ subject: string; html: string }>(`/admin/mail-templates/${key}/preview`, { ...draft.value });
    if (request !== previewRequest) return;
    preview.value = result;
    previewError.value = '';
  } catch (err) {
    if (request === previewRequest) previewError.value = errorMessage(err);
  }
}

async function save() {
  const key = currentKey.value;
  if (!key) return;
  saving.value = true;
  try {
    await api.put(`/admin/mail-templates/${key}`, { ...draft.value });
    toast.success('Vorlage gespeichert');
    await load(key);
  } catch (err) {
    toast.error(err);
  } finally {
    saving.value = false;
  }
}

async function reset() {
  const t = current.value;
  if (!t) return;
  const ok = await confirm.ask({
    title: 'Auf Standard zurücksetzen',
    message: `Betreff und Text von «${t.label}» wieder auf den Standard setzen? Die angepasste Fassung geht verloren.`,
    confirmLabel: 'Zurücksetzen',
    danger: true,
  });
  if (!ok) return;
  saving.value = true;
  try {
    await api.delete(`/admin/mail-templates/${t.key}`);
    toast.success('Vorlage auf Standard zurückgesetzt');
    await load(t.key);
  } catch (err) {
    toast.error(err);
  } finally {
    saving.value = false;
  }
}

function discard() {
  if (current.value) draft.value = { subject: current.value.subject, body: current.value.body };
}

/** Platzhalter an der Cursorposition im zuletzt benutzten Feld einfügen. */
async function insert(name: string) {
  const token = `{{${name}}}`;
  if (target.value === 'body' && bodyEditor.value) {
    bodyEditor.value.insertText(token);
    return;
  }
  const field = target.value === 'subject' ? subjectInput.value : bodyInput.value;
  const key = target.value;
  const value = draft.value[key];
  if (value === null || !field) return;
  const start = field.selectionStart ?? value.length;
  const end = field.selectionEnd ?? value.length;
  draft.value[key] = value.slice(0, start) + token + value.slice(end);
  await nextTick();
  field.focus();
  field.setSelectionRange(start + token.length, start + token.length);
}
</script>

<template>
  <div class="stack">
    <h1>E-Mail-Vorlagen</h1>
    <p class="muted intro">
      Betreff und Text der Mails, die Patchwork verschickt. Platzhalter wie <code v-text="'{{Titel}}'" /> ersetzt Patchwork beim
      Versand, eingefügt werden sie per Klick an der Cursorposition. Vor jeden Betreff setzt Patchwork die Nummer des Vorgangs,
      z.B. <code>[PW-123]</code>, damit Antworten richtig zugeordnet werden (nicht bei der Willkommens-Mail, sie gehört zu
      keinem Vorgang). Für einen Link auf den Vorgang den Text markieren,
      «Link» wählen und als Adresse <code v-text="'{{Link}}'" /> eintragen.
    </p>

    <div class="layout">
      <nav class="card list">
        <template v-for="g in GROUPS" :key="g.key">
          <h3>{{ g.label }}</h3>
          <button
            v-for="t in templates.filter((x) => x.group === g.key)"
            :key="t.key"
            type="button"
            class="entry"
            :class="{ active: t.key === currentKey }"
            @click="select(t.key)"
          >
            <span>{{ t.label }}</span>
            <span v-if="t.custom" class="badge custom">angepasst</span>
          </button>
        </template>
      </nav>

      <section v-if="current" class="card card-body stack editor">
        <div>
          <h2>{{ current.label }}</h2>
          <p class="muted intro">{{ current.description }}</p>
        </div>

        <div v-if="current.subject !== null" class="field">
          <label for="tpl-subject">Betreff</label>
          <div class="subject">
            <span v-if="!current.standalone" class="prefix">[PW-123]</span>
            <input
              id="tpl-subject"
              ref="subjectInput"
              v-model="draft.subject"
              class="input"
              maxlength="500"
              @focus="target = 'subject'"
            />
          </div>
        </div>

        <div v-if="current.body !== null && current.plain" class="field">
          <label for="tpl-body">Text (ohne Formatierung)</label>
          <textarea id="tpl-body" ref="bodyInput" v-model="draft.body" class="textarea mono" rows="3" @focus="target = 'body'" />
        </div>
        <div v-else-if="current.body !== null" class="field" @focusin="target = 'body'">
          <span class="label">Text</span>
          <!-- Pro Vorlage ein eigener Editor, damit «Rückgängig» nicht in die vorherige Vorlage zurückführt -->
          <MarkdownEditor
            :key="current.key"
            ref="bodyEditor"
            v-model="bodyText"
            :images="false"
            template
            :min-height="200"
            @submit="dirty && !saving && save()"
          />
        </div>
        <p v-else class="hint faint">Den Text schreibt der Bearbeiter in der Timeline. Hier lässt sich nur der Betreff anpassen.</p>

        <div class="placeholders">
          <span class="faint small">Platzhalter einfügen:</span>
          <button
            v-for="p in current.placeholders"
            :key="p.name"
            class="btn btn-sm"
            type="button"
            :title="`${p.description}, z.B. «${p.example}»`"
            @mousedown.prevent
            @click="insert(p.name)"
          >
            {{ p.name }}
          </button>
        </div>

        <div class="row">
          <button class="btn btn-primary" type="button" :disabled="!dirty || saving" @click="save">Speichern</button>
          <button v-if="dirty" class="btn" type="button" @click="discard">Änderungen verwerfen</button>
          <div class="spacer" />
          <button v-if="current.custom" class="btn" type="button" :disabled="saving" @click="reset">Auf Standard zurücksetzen</button>
        </div>

        <h3>Vorschau mit Beispieldaten</h3>
        <div v-if="previewError" class="error-box">{{ previewError }}</div>
        <div v-else-if="preview" class="preview">
          <div class="preview-subject"><span class="faint">Betreff:</span> {{ preview.subject }}</div>
          <iframe class="preview-frame" sandbox="" :srcdoc="preview.html" title="Vorschau der Mail" />
        </div>
      </section>
    </div>
  </div>
</template>

<style scoped>
.intro {
  margin: 0;
}
.layout {
  display: grid;
  grid-template-columns: 260px minmax(0, 1fr);
  gap: 16px;
  align-items: start;
}
.list {
  display: flex;
  flex-direction: column;
  gap: 2px;
  padding: 10px;
}
.list h3 {
  font-size: 12px;
  color: var(--text-muted);
  margin: 8px 6px 4px;
}
.list h3:first-child {
  margin-top: 0;
}
.entry {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 6px;
  padding: 6px 8px;
  border: none;
  border-radius: var(--radius-sm);
  background: none;
  color: var(--text);
  font: inherit;
  text-align: left;
  cursor: pointer;
}
.entry:hover {
  background: var(--surface-hover);
}
.entry.active {
  background: var(--accent-soft);
  color: var(--accent);
  font-weight: 500;
}
.badge.custom {
  background: var(--accent-soft);
  color: var(--accent);
  font-weight: 400;
}
.subject {
  display: flex;
  align-items: center;
  gap: 6px;
}
.prefix {
  font-family: var(--mono);
  font-size: 13px;
  color: var(--text-muted);
  white-space: nowrap;
}
.placeholders {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 6px;
}
.small {
  font-size: 12px;
}
.preview {
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  overflow: hidden;
}
.preview-subject {
  padding: 8px 12px;
  border-bottom: 1px solid var(--border);
  font-size: 13px;
}
.preview-frame {
  display: block;
  width: 100%;
  height: 360px;
  border: none;
  background: #fff;
}
code {
  font-family: var(--mono);
  font-size: 12px;
  background: var(--surface-2);
  padding: 1px 4px;
  border-radius: 4px;
}
@media (max-width: 900px) {
  .layout {
    grid-template-columns: 1fr;
  }
}
</style>
