import Mention from '@tiptap/extension-mention';
import type { SuggestionProps } from '@tiptap/suggestion';
import type { User } from './types';

/**
 * Erwähnungen in Antworten und Notizen: Mit «@» öffnet sich eine Auswahl der IT-Mitarbeitenden. Im Markdown steht
 * «[@Vorname Nachname](mention:<Benutzer-ID>)»; daraus liest das Backend, wer die Mail «Erwähnt» erhält.
 */

export interface MentionCandidate {
  id: string;
  label: string;
  email: string;
}

const UUID = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}';
const MENTION_AT_START = new RegExp(`^\\[@([^\\]\\n]{1,200})\\]\\(mention:(${UUID})\\)`);
const MENTION_ANYWHERE = new RegExp(`\\[@[^\\]\\n]{1,200}\\]\\(mention:${UUID}\\)`);
/** Ziel einer Erwähnung im Markdown-Link */
export const MENTION_HREF = new RegExp(`^mention:(${UUID})$`);

/** Name in der Erwähnung: «Vorname Nachname», ohne Vornamen und Nachnamen der Name */
export const mentionLabel = (u: Pick<User, 'name' | 'firstName' | 'lastName'>) => `${u.firstName} ${u.lastName}`.trim() || u.name;

/** Markdown einer Erwähnung; «]» und Zeilenumbrüche im Namen würden den Link brechen */
export const mentionMarkdown = (id: string, label: string) =>
  `[@${label.replace(/[\]\r\n]+/g, ' ').replace(/\s+/g, ' ').trim()}](mention:${id})`;

/** Auswahl zu «@…»: jedes Suchwort muss in Name oder E-Mail vorkommen, Gross- und Kleinschreibung egal */
export function filterCandidates(all: MentionCandidate[], query: string, limit = 8): MentionCandidate[] {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  return all.filter((c) => words.every((w) => `${c.label} ${c.email}`.toLowerCase().includes(w))).slice(0, limit);
}

/** Auswahlliste unter dem Cursor; Pfeiltasten, Enter oder Tab wählen, Klick ebenso */
function suggestionList() {
  let element: HTMLDivElement | null = null;
  let unmount: (() => void) | null = null;
  let current: SuggestionProps<MentionCandidate> | null = null;
  let selected = 0;

  const choose = (index: number) => {
    const item = current?.items[index];
    if (item) current!.command({ id: item.id, label: item.label });
  };

  const draw = () => {
    if (!element || !current) return;
    element.replaceChildren();
    element.hidden = current.items.length === 0;
    current.items.forEach((item, index) => {
      const option = document.createElement('button');
      option.type = 'button';
      option.className = `mention-option${index === selected ? ' active' : ''}`;
      option.setAttribute('role', 'option');
      option.setAttribute('aria-selected', String(index === selected));
      const name = document.createElement('span');
      name.textContent = item.label;
      const email = document.createElement('span');
      email.className = 'mention-email';
      email.textContent = item.email;
      option.append(name, email);
      // mousedown statt click: Der Editor behält den Fokus
      option.addEventListener('mousedown', (event) => {
        event.preventDefault();
        choose(index);
      });
      element!.append(option);
    });
  };

  return {
    onStart: (props: SuggestionProps<MentionCandidate>) => {
      current = props;
      selected = 0;
      element = document.createElement('div');
      element.className = 'mention-popup';
      element.setAttribute('role', 'listbox');
      element.setAttribute('aria-label', 'Person erwähnen');
      draw();
      unmount = props.mount(element);
    },
    onUpdate: (props: SuggestionProps<MentionCandidate>) => {
      current = props;
      selected = Math.min(selected, Math.max(0, props.items.length - 1));
      draw();
    },
    onKeyDown: ({ event }: { event: KeyboardEvent }) => {
      const count = current?.items.length ?? 0;
      if (count === 0) return false;
      if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
        selected = (selected + (event.key === 'ArrowDown' ? 1 : count - 1)) % count;
        draw();
        return true;
      }
      if ((event.key === 'Enter' && !event.ctrlKey && !event.metaKey) || event.key === 'Tab') {
        choose(selected);
        return true;
      }
      return false;
    },
    onExit: () => {
      unmount?.();
      unmount = null;
      element?.remove();
      element = null;
      current = null;
    },
  };
}

/** Erwähnungen im Editor; «candidates» liefert die IT-Mitarbeitenden zur Auswahl. */
export function mentionExtension(candidates: () => MentionCandidate[]) {
  return Mention.extend({
    // Als Markdown-Link mit eigenem Ziel statt der Standard-Schreibweise «[@ id="…"]»
    markdownTokenizer: {
      name: 'mention',
      level: 'inline',
      start: (src: string) => src.search(MENTION_ANYWHERE),
      tokenize: (src: string) => {
        const match = MENTION_AT_START.exec(src);
        return match ? { type: 'mention', raw: match[0], attributes: { label: match[1], id: match[2] } } : undefined;
      },
    },
    parseMarkdown: (token, helpers) =>
      helpers.createNode('mention', { id: token.attributes?.id ?? null, label: token.attributes?.label ?? null }),
    renderMarkdown: (node) => mentionMarkdown(String(node.attrs?.id ?? ''), String(node.attrs?.label ?? '')),
  }).configure({
    HTMLAttributes: { class: 'mention' },
    renderText: ({ node }) => `@${String(node.attrs.label ?? '')}`,
    renderHTML: ({ options, node }) => ['span', options.HTMLAttributes, `@${String(node.attrs.label ?? '')}`],
    suggestion: {
      char: '@',
      // Vor- und Nachname mit Leerzeichen suchen; ohne Treffer bleibt die Liste zu
      allowSpaces: true,
      items: ({ query }) => filterCandidates(candidates(), query),
      render: suggestionList,
    },
  });
}
