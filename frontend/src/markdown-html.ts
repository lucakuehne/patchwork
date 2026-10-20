import MarkdownIt from 'markdown-it';
import type Token from 'markdown-it/lib/token.mjs';

/** Wo ein Text erscheint: in Patchwork (IT) oder im Portal (Melder). Davon hängen die Adressen der Bilder ab. */
export type ImageContext = 'staff' | 'portal';

const md = new MarkdownIt({ html: false, linkify: true, breaks: true });

const UUID = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}';
const IMAGE_REF = new RegExp(`^(upload|attachment):(${UUID})$`);
const IMAGE_PATH = new RegExp(`^/api/(?:uploads/(${UUID})|(?:portal/)?attachments/(${UUID})/inline)$`);

/**
 * Bilder im Text stehen im Markdown als «upload:<id>» (frisch hochgeladen, noch nicht gespeichert) oder
 * «attachment:<id>» (eingebetteter Anhang). Liefert die Adresse zum Anzeigen; null bei fremden Bildern.
 */
export function imageUrl(src: string, context: ImageContext): string | null {
  const match = IMAGE_REF.exec(src);
  if (!match) return null;
  if (match[1] === 'upload') return `/api/uploads/${match[2]}`;
  return context === 'portal' ? `/api/portal/attachments/${match[2]}/inline` : `/api/attachments/${match[2]}/inline`;
}

/** Umkehrung von imageUrl, z.B. für ein aus der Timeline kopiertes Bild. Nur Adressen von Patchwork selbst. */
export function imageRef(url: string, origin: string): string | null {
  const path = url.startsWith(`${origin}/`) ? url.slice(origin.length) : url;
  const match = IMAGE_PATH.exec(path);
  if (!match) return null;
  return match[1] ? `upload:${match[1]}` : `attachment:${match[2]}`;
}

/** Anhänge, die als Bild im Text stehen. Die Liste der Anhänge zeigt sie nicht noch einmal. */
export function imagesInText(markdown: string): Set<string> {
  const pattern = new RegExp(`!\\[[^\\]\\n]*\\]\\(attachment:(${UUID})\\)`, 'g');
  return new Set([...markdown.matchAll(pattern)].map((m) => m[1]!));
}

/** Steht das Element innerhalb eines Links? Dann kein zweiter Link um das Bild. */
function insideLink(tokens: Token[], idx: number): boolean {
  let depth = 0;
  for (let i = 0; i < idx; i++) {
    if (tokens[i]!.type === 'link_open') depth++;
    else if (tokens[i]!.type === 'link_close') depth--;
  }
  return depth > 0;
}

// Eigene Bilder auf Textbreite, ein Klick öffnet sie in voller Grösse. Fremde Bilder (z.B. aus dem Internet) werden
// nicht geladen, sie erscheinen als Link.
md.renderer.rules.image = (tokens, idx, options, env: { context?: ImageContext }, self) => {
  const token = tokens[idx]!;
  const alt = self.renderInlineAsText(token.children ?? [], options, env);
  const src = token.attrGet('src') ?? '';
  const escape = md.utils.escapeHtml;
  const url = imageUrl(src, env.context ?? 'staff');
  if (!url) return insideLink(tokens, idx) ? escape(alt || src) : `<a href="${escape(src)}">${escape(alt || src)}</a>`;
  const img = `<img src="${url}" alt="${escape(alt)}" class="text-image" loading="lazy">`;
  return insideLink(tokens, idx) ? img : `<a href="${url}" class="text-image-link" title="In voller Grösse öffnen">${img}</a>`;
};

/** Markdown als HTML, noch nicht bereinigt. Im Browser immer über renderMarkdown (markdown.ts). */
export function markdownToHtml(source: string, context: ImageContext): string {
  return md.render(source, { context });
}
