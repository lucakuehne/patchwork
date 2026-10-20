<script setup lang="ts">
import { Markdown } from '@tiptap/markdown';
import StarterKit from '@tiptap/starter-kit';
import { Placeholder } from '@tiptap/extensions';
import { EditorContent, useEditor } from '@tiptap/vue-3';
import { onBeforeUnmount, watch } from 'vue';

/**
 * WYSIWYG-Editor mit Toolbar. Gespeichert wird Markdown.
 */
const props = withDefaults(defineProps<{ placeholder?: string; minHeight?: number; autofocus?: boolean }>(), {
  placeholder: '',
  minHeight: 120,
  autofocus: false,
});
const model = defineModel<string>({ required: true });
const emit = defineEmits<{ submit: [] }>();

const editor = useEditor({
  content: model.value,
  contentType: 'markdown',
  autofocus: props.autofocus ? 'end' : false,
  extensions: [
    StarterKit.configure({
      // Unterstreichen gibt es in Markdown nicht; Trennlinien braucht es nicht
      underline: false,
      horizontalRule: false,
      heading: { levels: [2, 3] },
      link: { openOnClick: false, autolink: true, defaultProtocol: 'https' },
    }),
    Markdown.configure({ markedOptions: { gfm: true, breaks: true } }),
    Placeholder.configure({ placeholder: () => props.placeholder }),
  ],
  editorProps: {
    attributes: { class: 'prose md-content', spellcheck: 'true' },
    handleKeyDown: (_view, event) => {
      if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) {
        emit('submit');
        return true;
      }
      return false;
    },
  },
  onUpdate: ({ editor: e }) => {
    model.value = e.isEmpty ? '' : e.getMarkdown().trim();
  },
});

// Änderungen von aussen übernehmen (z.B. Leeren nach dem Senden)
watch(model, (value) => {
  const e = editor.value;
  if (!e) return;
  const current = e.isEmpty ? '' : e.getMarkdown().trim();
  if (value !== current) e.commands.setContent(value, { contentType: 'markdown', emitUpdate: false });
});

// Neuer Platzhalter (z.B. beim Wechsel öffentlich/intern): Ansicht neu zeichnen, sonst bleibt der alte stehen
watch(
  () => props.placeholder,
  () => {
    const e = editor.value;
    if (e) e.view.dispatch(e.state.tr);
  },
);

onBeforeUnmount(() => editor.value?.destroy());

/** Fügt Markdown an der Cursorposition ein (z.B. Textbausteine). */
function insertMarkdown(markdown: string) {
  editor.value?.chain().focus().insertContent(markdown, { contentType: 'markdown' }).run();
}

/** Fügt Text im laufenden Absatz an der Cursorposition ein (z.B. Platzhalter wie {{Melder}}). */
function insertText(text: string) {
  editor.value?.chain().focus().insertContent({ type: 'text', text }).run();
}

function setLink() {
  const e = editor.value;
  if (!e) return;
  const previous = (e.getAttributes('link').href as string | undefined) ?? '';
  const url = window.prompt('Link-Adresse (leer lassen zum Entfernen)', previous);
  if (url === null) return;
  if (url.trim() === '') {
    e.chain().focus().extendMarkRange('link').unsetLink().run();
    return;
  }
  e.chain().focus().extendMarkRange('link').setLink({ href: url.trim() }).run();
}

interface Tool {
  label: string;
  title: string;
  action: () => void;
  active?: () => boolean;
  class?: string;
  /** Symbol statt Beschriftung: drei Punkte bzw. drei Nummern untereinander */
  icon?: 'bulletList' | 'orderedList';
}

const tools = (): (Tool | 'sep')[] => {
  const e = editor.value!;
  return [
    { label: 'B', title: 'Fett (Ctrl+B)', class: 'b', action: () => e.chain().focus().toggleBold().run(), active: () => e.isActive('bold') },
    { label: 'I', title: 'Kursiv (Ctrl+I)', class: 'i', action: () => e.chain().focus().toggleItalic().run(), active: () => e.isActive('italic') },
    { label: 'S', title: 'Durchgestrichen', class: 's', action: () => e.chain().focus().toggleStrike().run(), active: () => e.isActive('strike') },
    'sep',
    { label: 'H2', title: 'Überschrift', action: () => e.chain().focus().toggleHeading({ level: 2 }).run(), active: () => e.isActive('heading', { level: 2 }) },
    { label: 'H3', title: 'Unterüberschrift', action: () => e.chain().focus().toggleHeading({ level: 3 }).run(), active: () => e.isActive('heading', { level: 3 }) },
    'sep',
    { label: '', icon: 'bulletList', title: 'Aufzählung', action: () => e.chain().focus().toggleBulletList().run(), active: () => e.isActive('bulletList') },
    { label: '', icon: 'orderedList', title: 'Nummerierte Liste', action: () => e.chain().focus().toggleOrderedList().run(), active: () => e.isActive('orderedList') },
    { label: '❝', title: 'Zitat', action: () => e.chain().focus().toggleBlockquote().run(), active: () => e.isActive('blockquote') },
    'sep',
    { label: '</>', title: 'Code', class: 'mono', action: () => e.chain().focus().toggleCode().run(), active: () => e.isActive('code') },
    { label: '{ }', title: 'Codeblock', class: 'mono', action: () => e.chain().focus().toggleCodeBlock().run(), active: () => e.isActive('codeBlock') },
    { label: 'Link', title: 'Link', action: setLink, active: () => e.isActive('link') },
    'sep',
    { label: '↶', title: 'Rückgängig (Ctrl+Z)', action: () => e.chain().focus().undo().run() },
    { label: '↷', title: 'Wiederholen (Ctrl+Y)', action: () => e.chain().focus().redo().run() },
  ];
};

/** Fokus setzen, z.B. nach dem Öffnen eines Dialogs. */
function focus() {
  editor.value?.commands.focus('end');
}
defineExpose({ focus, insertMarkdown, insertText });
</script>

<template>
  <div class="md-editor" :style="{ '--min-height': `${minHeight}px` }">
    <div v-if="editor" class="toolbar" role="toolbar" aria-label="Formatierung">
      <template v-for="(tool, i) in tools()" :key="i">
        <span v-if="tool === 'sep'" class="sep" />
        <button
          v-else
          type="button"
          class="tool"
          :class="[tool.class, { active: tool.active?.() }]"
          :title="tool.title"
          :aria-label="tool.title"
          :aria-pressed="tool.active?.() ?? undefined"
          @mousedown.prevent
          @click="tool.action"
        >
          <svg v-if="tool.icon === 'bulletList'" class="icon" viewBox="0 0 16 16" aria-hidden="true">
            <circle cx="2.5" cy="3.5" r="1.4" />
            <circle cx="2.5" cy="8" r="1.4" />
            <circle cx="2.5" cy="12.5" r="1.4" />
            <path d="M6 3.5h8.5M6 8h8.5M6 12.5h8.5" />
          </svg>
          <svg v-else-if="tool.icon === 'orderedList'" class="icon" viewBox="0 0 16 16" aria-hidden="true">
            <text x="0.6" y="5.2">1</text>
            <text x="0.6" y="9.7">2</text>
            <text x="0.6" y="14.2">3</text>
            <path d="M6 3.5h8.5M6 8h8.5M6 12.5h8.5" />
          </svg>
          <template v-else>{{ tool.label }}</template>
        </button>
      </template>
    </div>
    <EditorContent :editor="editor" class="content" />
  </div>
</template>

<style scoped>
.md-editor {
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  background: var(--surface);
  display: flex;
  flex-direction: column;
}
.md-editor:focus-within {
  border-color: var(--accent);
  outline: 2px solid var(--accent-soft);
}
.toolbar {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 2px;
  padding: 4px;
  border-bottom: 1px solid var(--border);
  background: var(--surface-2);
  border-radius: var(--radius-sm) var(--radius-sm) 0 0;
}
.tool {
  min-width: 28px;
  height: 26px;
  padding: 0 6px;
  border: 1px solid transparent;
  border-radius: 4px;
  background: transparent;
  color: var(--text-muted);
  font: inherit;
  font-size: 13px;
  cursor: pointer;
}
.tool:hover {
  background: var(--surface-hover);
  color: var(--text);
}
.tool.active {
  background: var(--accent-soft);
  color: var(--accent);
  border-color: var(--accent-soft);
}
.tool.b {
  font-weight: 700;
}
.tool.i {
  font-style: italic;
}
.tool.s {
  text-decoration: line-through;
}
.tool.mono {
  font-family: var(--mono);
  font-size: 12px;
}
.icon {
  width: 16px;
  height: 16px;
  vertical-align: -3px;
  fill: currentColor;
}
.icon path {
  fill: none;
  stroke: currentColor;
  stroke-width: 1.4;
  stroke-linecap: round;
}
.icon text {
  font-family: var(--font);
  font-size: 5px;
  font-weight: 700;
}
.sep {
  width: 1px;
  height: 18px;
  margin: 0 4px;
  background: var(--border);
}
.content {
  flex: 1;
  cursor: text;
}
.content :deep(.md-content) {
  min-height: var(--min-height);
  padding: 8px 10px;
  outline: none;
  line-height: 1.5;
}
.content :deep(.md-content p.is-editor-empty:first-child::before) {
  content: attr(data-placeholder);
  color: var(--text-faint);
  float: left;
  height: 0;
  pointer-events: none;
}
.content :deep(.md-content h2) {
  font-size: 17px;
  margin: 10px 0 6px;
}
.content :deep(.md-content h3) {
  font-size: 15px;
  margin: 8px 0 4px;
}
.content :deep(.md-content a) {
  color: var(--accent);
  text-decoration: underline;
}
</style>
