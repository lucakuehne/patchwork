import { Editor } from '@tiptap/core';
import { Markdown } from '@tiptap/markdown';
import StarterKit from '@tiptap/starter-kit';
import { describe, expect, it } from 'vitest';
import { markdownToHtml } from './markdown-html';
import { filterCandidates, mentionExtension, mentionLabel, mentionMarkdown } from './mentions';

const IVAN = '0b6a1c4e-9f2d-4c8e-a1b2-3c4d5e6f7a8b';
const candidates = [
  { id: IVAN, label: 'Ivan Informatik', email: 'ivan@firma.ch' },
  { id: '1c7b2d5f-0a3e-4d9f-b2c3-4d5e6f7a8b9c', label: 'Ada Admin', email: 'ada@firma.ch' },
];

describe('Erwähnungen', () => {
  it('Auswahl: jedes Wort in Name oder E-Mail', () => {
    expect(filterCandidates(candidates, '').map((c) => c.label)).toEqual(['Ivan Informatik', 'Ada Admin']);
    expect(filterCandidates(candidates, 'inf IV').map((c) => c.label)).toEqual(['Ivan Informatik']);
    expect(filterCandidates(candidates, 'ada@').map((c) => c.label)).toEqual(['Ada Admin']);
    expect(filterCandidates(candidates, 'niemand')).toEqual([]);
  });

  it('Name: Vor- und Nachname, sonst der Name; Markdown ohne störende Zeichen', () => {
    expect(mentionLabel({ name: 'Informatik, Ivan', firstName: 'Ivan', lastName: 'Informatik' })).toBe('Ivan Informatik');
    expect(mentionLabel({ name: 'Helpdesk', firstName: '', lastName: '' })).toBe('Helpdesk');
    expect(mentionMarkdown(IVAN, 'Ivan ] Informatik\n')).toBe(`[@Ivan Informatik](mention:${IVAN})`);
  });

  it('in Patchwork hervorgehoben, im Portal als gewöhnlicher Text', () => {
    const md = `Hallo [@Ivan Informatik](mention:${IVAN}), siehe [Link](https://firma.ch)`;
    expect(markdownToHtml(md, 'staff')).toContain(`<span class="mention" data-user-id="${IVAN}">@Ivan Informatik</span>`);
    expect(markdownToHtml(md, 'staff')).toContain('<a href="https://firma.ch">Link</a>');
    const portal = markdownToHtml(md, 'portal');
    expect(portal).toContain('Hallo @Ivan Informatik, siehe');
    expect(portal).not.toContain('mention');
  });

  it('bleibt im Editor erhalten (Markdown hin und zurück)', () => {
    const editor = new Editor({
      extensions: [StarterKit, Markdown, mentionExtension(() => candidates)],
      content: `Bitte [@Ivan Informatik](mention:${IVAN}) **prüfen**`,
      contentType: 'markdown',
    });
    const paragraph = editor.getJSON().content?.[0] as { content?: { type?: string; attrs?: Record<string, unknown> }[] };
    const mention = paragraph.content?.find((n) => n.type === 'mention');
    expect(mention?.attrs).toMatchObject({ id: IVAN, label: 'Ivan Informatik' });
    expect(editor.getMarkdown().trim()).toBe(`Bitte [@Ivan Informatik](mention:${IVAN}) **prüfen**`);
    editor.destroy();
  });
});
