// @vitest-environment jsdom
import { Editor } from '@tiptap/core';
import { Markdown } from '@tiptap/markdown';
import StarterKit from '@tiptap/starter-kit';
import { afterEach, describe, expect, it } from 'vitest';
import {
  allowPlaceholderLinks,
  isPlaceholderHref,
  normalizePlaceholderHref,
  PlaceholderHighlight,
  placeholderRanges,
} from './text-placeholders';

let editor: Editor | null = null;

afterEach(() => {
  editor?.destroy();
  editor = null;
});

/** Editor wie in MarkdownEditor.vue mit «template», ohne Vue */
function create(content: string): Editor {
  editor = new Editor({
    content,
    contentType: 'markdown',
    extensions: [
      StarterKit.configure({
        underline: false,
        horizontalRule: false,
        heading: { levels: [2, 3] },
        link: { openOnClick: false, autolink: true, defaultProtocol: 'https', isAllowedUri: allowPlaceholderLinks },
      }),
      Markdown.configure({ markedOptions: { gfm: true, breaks: true } }),
      PlaceholderHighlight,
    ],
  });
  return editor;
}

const highlighted = (e: Editor) => Array.from(e.view.dom.querySelectorAll('.placeholder-token')).map((el) => el.textContent);
const markdown = (e: Editor) => e.getMarkdown().trim();

describe('Platzhalter im Editor', () => {
  it('lässt Platzhalter und Link-Zeilen beim Bearbeiten unverändert', () => {
    for (const text of [
      'Guten Tag {{Melder Vorname}} {{Melder Nachname}}\n\nIhre Nachricht wurde unter der Nummer **{{Nummer}}** erfasst.',
      '[Ihre Meldung online ansehen]({{Link}})',
      'Öffnen: {{Link}}',
    ]) {
      expect(markdown(create(text))).toBe(text);
      editor!.destroy();
    }
  });

  it('hebt Platzhalter hervor, auch teilweise formatiert und nach Änderungen', () => {
    const e = create('Guten Tag {{Melder Vorname}}, zu **{{Nummer}}** «{{Ti*tel*}}» {{ }} {{App');
    expect(highlighted(e)).toEqual(['{{Melder Vorname}}', '{{Nummer}}', '{{Ti', 'tel', '}}']);
    e.commands.focus('end');
    e.commands.insertContent({ type: 'text', text: ' {{Zuständig Nachname}}' });
    expect(highlighted(e).at(-1)).toBe('{{Zuständig Nachname}}');
    expect(markdown(e)).toBe('Guten Tag {{Melder Vorname}}, zu **{{Nummer}}** «{{Ti*tel*}}» {{ }} {{App {{Zuständig Nachname}}');
  });

  it('fügt Platzhalter an der Cursorposition ein, im markierten Text als Ersatz', () => {
    // Wie insertText in MarkdownEditor.vue
    const insert = (e: Editor, text: string) => e.chain().focus(null).insertContent({ type: 'text', text }).run();
    const e = create('Guten Tag **Herr**');
    e.commands.setTextSelection(7);
    insert(e, '{{Melder Vorname}} ');
    expect(markdown(e)).toBe('Guten {{Melder Vorname}} Tag **Herr**');
    const herr = e.state.doc.textContent.indexOf('Herr') + 1;
    e.commands.setTextSelection({ from: herr, to: herr + 4 });
    insert(e, '{{Melder Nachname}}');
    expect(markdown(e)).toBe('Guten {{Melder Vorname}} Tag **{{Melder Nachname}}**');
    expect(highlighted(e)).toEqual(['{{Melder Vorname}}', '{{Melder Nachname}}']);
  });

  it('setzt einen Link mit Ziel {{Link}} und speichert ihn als Markdown', () => {
    const e = create('Meldung ansehen');
    e.commands.selectAll();
    expect(e.commands.setLink({ href: '{{Link}}' })).toBe(true);
    expect(markdown(e)).toBe('[Meldung ansehen]({{Link}})');
    expect(e.view.dom.querySelector('a')?.getAttribute('href')).toBe('{{Link}}');
  });

  it('übernimmt eingefügte Links mit Platzhalter, aber keine gefährlichen', () => {
    const e = create('');
    e.commands.insertContent('<p><a href="{{Link}}">Ansehen</a> <a href="javascript:alert(1)">Böse</a></p>');
    expect(markdown(e)).toBe('[Ansehen]({{Link}}) Böse');
  });
});

describe('placeholderRanges', () => {
  it('findet Platzhalter über Zeilenumbrüche hinweg an der richtigen Stelle', () => {
    const e = create('Zugewiesen: {{Nummer}}\nMelder: {{Melder Vorname}}');
    const ranges = placeholderRanges(e.state.doc);
    expect(ranges.map((r) => e.state.doc.textBetween(r.from, r.to))).toEqual(['{{Nummer}}', '{{Melder Vorname}}']);
    // Einfacher Zeilenumbruch (z.B. Vorlage «Zugewiesen») als harter Umbruch mit zwei Leerzeichen
    expect(markdown(e)).toBe('Zugewiesen: {{Nummer}}  \nMelder: {{Melder Vorname}}');
  });
});

describe('isPlaceholderHref', () => {
  it('erkennt Platzhalter als Link-Ziel', () => {
    expect(isPlaceholderHref('{{Link}}')).toBe(true);
    // Mit Leerraum kein gültiges Markdown-Link-Ziel; beim Setzen wird bereinigt
    expect(isPlaceholderHref('{{ Link }}')).toBe(false);
    expect(normalizePlaceholderHref(' {{ Link }} ')).toBe('{{Link}}');
    expect(normalizePlaceholderHref(' https://x.test ')).toBe('https://x.test');
    expect(isPlaceholderHref('{{}}')).toBe(false);
    expect(isPlaceholderHref('https://x.test/{{Link}}')).toBe(false);
    const defaultValidate = (url: string) => url.startsWith('https:');
    expect(allowPlaceholderLinks('{{Link}}', { defaultValidate })).toBe(true);
    expect(allowPlaceholderLinks('javascript:alert(1)', { defaultValidate })).toBe(false);
  });
});
