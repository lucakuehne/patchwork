<script setup lang="ts">
import { Markdown } from '@tiptap/markdown';
import StarterKit from '@tiptap/starter-kit';
import { Placeholder } from '@tiptap/extensions';
import { EditorContent, useEditor } from '@tiptap/vue-3';
import { onBeforeUnmount, ref, watch } from 'vue';
import { api, errorMessage } from '../api';
import type { ImageContext } from '../markdown';
import { clipboardHasText, imageAlt, textImage } from '../text-image';

/**
 * WYSIWYG-Editor mit Toolbar. Gespeichert wird Markdown.
 * Bilder im Text («images»): über den Knopf «Bild», aus der Zwischenablage (Ctrl+V) oder per Hineinziehen. Sie werden
 * sofort hochgeladen und stehen im Text als «upload:<id>», bis der Text gespeichert ist. «context»: Portal oder IT.
 */
const props = withDefaults(
  defineProps<{ placeholder?: string; minHeight?: number; autofocus?: boolean; images?: boolean; context?: ImageContext }>(),
  { placeholder: '', minHeight: 120, autofocus: false, images: true, context: 'staff' },
);
const model = defineModel<string>({ required: true });
/** Solange ein Bild hochgeladen wird, wartet das Senden */
const uploading = defineModel<boolean>('uploading', { default: false });
const emit = defineEmits<{ submit: [] }>();

const IMAGE_TYPES = ['image/png', 'image/jpeg', 'image/gif', 'image/webp'];
const MAX_IMAGE_BYTES = 10 * 1024 * 1024;
const pending = ref(0);
const imageError = ref('');
const fileInput = ref<HTMLInputElement | null>(null);
watch(pending, (count) => (uploading.value = count > 0));

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
    ...(props.images ? [textImage({ context: () => props.context, origin: window.location.origin })] : []),
  ],
  editorProps: {
    attributes: { class: 'prose md-content', spellcheck: 'true' },
    handleKeyDown: (_view, event) => {
      if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) {
        // Erst senden, wenn alle Bilder hochgeladen sind
        if (pending.value === 0) emit('submit');
        return true;
      }
      return false;
    },
    handlePaste: (_view, event) => {
      const data = event.clipboardData;
      if (!props.images || !data || data.files.length === 0 || clipboardHasText(data)) return false;
      void addImages(Array.from(data.files));
      return true;
    },
    handleDrop: (view, event, _slice, moved) => {
      const files = Array.from(event.dataTransfer?.files ?? []);
      if (!props.images || moved || files.length === 0) return false;
      event.preventDefault();
      const target = view.posAtCoords({ left: event.clientX, top: event.clientY });
      if (target) editor.value?.commands.setTextSelection(target.pos);
      void addImages(files);
      return true;
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

/** Lädt Bilder hoch und fügt sie nacheinander an der Cursorposition ein, jedes in einem eigenen Absatz. */
async function addImages(files: File[]) {
  imageError.value = '';
  const images = files.filter((f) => IMAGE_TYPES.includes(f.type));
  if (images.length < files.length) {
    imageError.value = 'Im Text gehen nur Bilder (PNG, JPEG, GIF, WebP). Andere Dateien bitte als Anhang hinzufügen.';
  }
  for (const file of images) {
    if (file.size > MAX_IMAGE_BYTES) {
      imageError.value = `«${file.name}» ist grösser als 10 MB. Grössere Bilder bitte als Anhang hinzufügen.`;
      continue;
    }
    pending.value++;
    try {
      const form = new FormData();
      form.append('file', file, file.name);
      const uploaded = await api.post<{ id: string; ref: string }>('/uploads/images', form);
      const e = editor.value;
      if (!e || e.isDestroyed) return;
      e.chain()
        .focus()
        .insertContent({ type: 'paragraph', content: [{ type: 'image', attrs: { src: uploaded.ref, alt: imageAlt(file.name) } }] })
        .run();
    } catch (err) {
      imageError.value = errorMessage(err);
    } finally {
      pending.value--;
    }
  }
}

function onPick(event: Event) {
  const input = event.target as HTMLInputElement;
  const files = Array.from(input.files ?? []);
  input.value = '';
  void addImages(files);
}

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
  /** Symbol statt Beschriftung: drei Punkte bzw. drei Nummern untereinander, Bild */
  icon?: 'bulletList' | 'orderedList' | 'image';
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
    ...(props.images
      ? [{ label: '', icon: 'image' as const, title: 'Bild einfügen (auch mit Ctrl+V oder per Hineinziehen)', action: () => fileInput.value?.click() }]
      : []),
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
          <svg v-else-if="tool.icon === 'image'" class="icon" viewBox="0 0 16 16" aria-hidden="true">
            <rect x="1.5" y="2.5" width="13" height="11" rx="1.5" />
            <circle cx="5.5" cy="6.3" r="1.3" />
            <path d="M2 12.5l4-4 3 3 2-2 3.5 3.5" />
          </svg>
          <template v-else>{{ tool.label }}</template>
        </button>
      </template>
      <input
        v-if="images"
        ref="fileInput"
        type="file"
        accept="image/png,image/jpeg,image/gif,image/webp"
        multiple
        hidden
        @change="onPick"
      />
    </div>
    <EditorContent :editor="editor" class="content" />
    <div v-if="pending" class="image-status">Bild wird hochgeladen …</div>
    <div v-if="imageError" class="image-status error">
      <span>{{ imageError }}</span>
      <button type="button" class="dismiss" aria-label="Meldung schliessen" @click="imageError = ''">✕</button>
    </div>
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
.icon path,
.icon rect {
  fill: none;
  stroke: currentColor;
  stroke-width: 1.4;
  stroke-linecap: round;
  stroke-linejoin: round;
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
.content :deep(.md-content img) {
  display: inline-block;
  vertical-align: bottom;
  border: 1px solid var(--border);
  border-radius: 4px;
}
.content :deep(.md-content img.ProseMirror-selectednode) {
  outline: 2px solid var(--accent);
}
.image-status {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 4px 10px;
  border-top: 1px solid var(--border);
  font-size: 12px;
  color: var(--text-muted);
}
.image-status.error {
  color: var(--danger);
  background: var(--danger-soft);
}
.dismiss {
  margin-left: auto;
  border: none;
  background: none;
  color: inherit;
  cursor: pointer;
  font-size: 12px;
}
</style>
