import { Extension } from '@tiptap/core';
import type { Node as ProseMirrorNode } from '@tiptap/pm/model';
import { Plugin, PluginKey } from '@tiptap/pm/state';
import { Decoration, DecorationSet } from '@tiptap/pm/view';

/**
 * Platzhalter in E-Mail-Vorlagen und Textbausteinen, z.B. {{Titel}} oder {{Melder Vorname}}. Im Editor farbig
 * hervorgehoben und als Ziel von Links erlaubt ([Text]({{Link}})). Ersetzt werden sie beim Versand bzw. beim Einfügen.
 */
const PLACEHOLDER = /\{\{[^{}\n]*[^{}\s][^{}\n]*\}\}/g;

/**
 * Ist die Link-Adresse ein Platzhalter, z.B. {{Link}}? Nur ohne Leerraum: Ein Markdown-Link-Ziel endet beim ersten
 * Leerzeichen, «{{ Link }}» ginge beim Speichern verloren (siehe normalizePlaceholderHref).
 */
export function isPlaceholderHref(href: string): boolean {
  return /^\{\{[^{}\s]+\}\}$/.test(href.trim());
}

/** Leerzeichen innen weglassen: « {{ Link }} » → «{{Link}}»; andere Adressen nur getrimmt */
export function normalizePlaceholderHref(href: string): string {
  const match = /^\{\{\s*([^{}]*?)\s*\}\}$/.exec(href.trim());
  return match ? `{{${match[1]}}}` : href.trim();
}

/** Für die Link-Extension: Platzhalter wie {{Link}} als Ziel zulassen, sonst die übliche Prüfung der Protokolle. */
export function allowPlaceholderLinks(url: string, context: { defaultValidate: (url: string) => boolean }): boolean {
  return isPlaceholderHref(url) || context.defaultValidate(url);
}

/** Lage der Platzhalter im Dokument, auch wenn ein Teil formatiert ist (z.B. fett). */
export function placeholderRanges(doc: ProseMirrorNode): { from: number; to: number }[] {
  const ranges: { from: number; to: number }[] = [];
  doc.descendants((node, pos) => {
    if (!node.isTextblock) return true;
    // Text des Absatzes; andere Inline-Knoten (z.B. Zeilenumbruch) als Zeilenende, damit die Positionen stimmen
    let text = '';
    node.forEach((child) => {
      text += child.isText ? child.text! : '\n'.repeat(child.nodeSize);
    });
    for (const match of text.matchAll(PLACEHOLDER)) {
      const from = pos + 1 + match.index;
      ranges.push({ from, to: from + match[0].length });
    }
    return false;
  });
  return ranges;
}

const highlightKey = new PluginKey<DecorationSet>('placeholderHighlight');

const decorate = (doc: ProseMirrorNode) =>
  DecorationSet.create(
    doc,
    placeholderRanges(doc).map((r) => Decoration.inline(r.from, r.to, { class: 'placeholder-token' })),
  );

/** Hebt Platzhalter im Editor hervor (Klasse «placeholder-token»); am gespeicherten Markdown ändert sich nichts. */
export const PlaceholderHighlight = Extension.create({
  name: 'placeholderHighlight',
  addProseMirrorPlugins() {
    return [
      new Plugin<DecorationSet>({
        key: highlightKey,
        state: {
          init: (_config, state) => decorate(state.doc),
          apply: (tr, previous) => (tr.docChanged ? decorate(tr.doc) : previous),
        },
        props: {
          decorations: (state) => highlightKey.getState(state),
        },
      }),
    ];
  },
});
