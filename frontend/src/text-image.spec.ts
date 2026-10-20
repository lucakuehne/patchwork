// @vitest-environment jsdom
import { Editor } from '@tiptap/core';
import { Markdown } from '@tiptap/markdown';
import StarterKit from '@tiptap/starter-kit';
import { afterEach, describe, expect, it } from 'vitest';
import { clipboardHasText, imageAlt, imageBlock, textImage } from './text-image';

const ID = '0b1e8f2a-1c3d-4e5f-8a9b-0c1d2e3f4a5b';
let editor: Editor | null = null;

afterEach(() => {
  editor?.destroy();
  editor = null;
});

/** Editor wie in MarkdownEditor.vue, ohne Vue */
function create(content: string, context: 'staff' | 'portal' = 'staff'): Editor {
  editor = new Editor({
    content,
    contentType: 'markdown',
    extensions: [
      StarterKit.configure({ underline: false, horizontalRule: false, heading: { levels: [2, 3] } }),
      Markdown.configure({ markedOptions: { gfm: true, breaks: true } }),
      textImage({ context: () => context, origin: 'https://pw.test' }),
    ],
  });
  return editor;
}

describe('Bilder im Editor', () => {
  it('lässt Bilder beim Bearbeiten unverändert', () => {
    const markdown = `Text davor\n\n![Fehler.png](attachment:${ID})\n\nText danach`;
    expect(create(markdown).getMarkdown().trim()).toBe(markdown);
  });

  it('zeigt das Bild über die Adresse des Servers an, je nach Ort', () => {
    expect(create(`![a](upload:${ID})`).view.dom.querySelector('img')?.getAttribute('src')).toBe(`/api/uploads/${ID}`);
    editor!.destroy();
    const img = create(`![a](attachment:${ID})`, 'portal').view.dom.querySelector('img');
    expect(img?.getAttribute('src')).toBe(`/api/portal/attachments/${ID}/inline`);
    expect(img?.getAttribute('data-ref')).toBe(`attachment:${ID}`);
  });

  it('fügt ein hochgeladenes Bild als eigenen Absatz ein', () => {
    const e = create('Hallo');
    e.commands.focus('end');
    e.commands.insertContent({
      type: 'paragraph',
      content: [{ type: 'image', attrs: { src: `upload:${ID}`, alt: 'Screenshot.png' } }],
    });
    expect(e.getMarkdown().trim()).toBe(`Hallo\n\n![Screenshot.png](upload:${ID})`);
  });

  it('setzt den Cursor nach dem Bild in eine neue Zeile, ohne leeren Absatz im Markdown', () => {
    const e = create('Hallo');
    e.commands.focus('end');
    e.commands.insertContent(imageBlock(`upload:${ID}`, 'Screenshot.png'));
    expect(e.getMarkdown().trim()).toBe(`Hallo\n\n![Screenshot.png](upload:${ID})`);
    e.commands.insertContent('Darunter');
    expect(e.getMarkdown().trim()).toBe(`Hallo\n\n![Screenshot.png](upload:${ID})\n\nDarunter`);
  });

  it('übernimmt aus eingefügtem HTML nur Bilder von Patchwork', () => {
    const e = create('');
    e.commands.insertContent(
      `<p>A<img src="https://pw.test/api/attachments/${ID}/inline" alt="x">B<img src="https://evil.test/t.png" alt="y">C</p>`,
    );
    expect(e.getMarkdown().trim()).toBe(`A![x](attachment:${ID})BC`);
  });

  it('erkennt Bilder, die innerhalb von Patchwork kopiert wurden', () => {
    const e = create('');
    e.commands.insertContent(`<p><img src="/api/uploads/${ID}" data-ref="upload:${ID}" alt="z"></p>`);
    expect(e.getMarkdown().trim()).toBe(`![z](upload:${ID})`);
  });
});

describe('imageAlt', () => {
  it('entfernt Zeichen, die das Markdown des Bilds zerbrechen', () => {
    expect(imageAlt('Fehler [1]\r\n.png')).toBe('Fehler  1 .png');
    expect(imageAlt('[]')).toBe('Bild');
  });
});

describe('clipboardHasText', () => {
  const clipboard = (data: Record<string, string>) => ({ getData: (type: string) => data[type] ?? '' }) as unknown as DataTransfer;

  it('nimmt beim Bild aus dem Browser oder einem Screenshot das Bild', () => {
    expect(clipboardHasText(clipboard({ 'text/html': '<meta charset="utf-8"><img src="https://x.test/a.png">' }))).toBe(false);
    expect(clipboardHasText(clipboard({}))).toBe(false);
  });

  it('nimmt bei Text (z.B. aus Excel) den Text', () => {
    expect(clipboardHasText(clipboard({ 'text/html': '<table><tr><td>42</td></tr></table>' }))).toBe(true);
    expect(clipboardHasText(clipboard({ 'text/plain': 'Hallo' }))).toBe(true);
  });
});
