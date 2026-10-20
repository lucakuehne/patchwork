import DOMPurify from 'dompurify';
import { markdownToHtml, type ImageContext } from './markdown-html';

export { imageRef, imagesInText, imageUrl, type ImageContext } from './markdown-html';

// Links in neuem Tab öffnen
DOMPurify.addHook('afterSanitizeAttributes', (node) => {
  if (node.tagName === 'A') {
    node.setAttribute('target', '_blank');
    node.setAttribute('rel', 'noopener noreferrer nofollow');
  }
});

/** Markdown als bereinigtes HTML; «context» bestimmt die Adressen der Bilder im Text. */
export function renderMarkdown(source: string, context: ImageContext = 'staff'): string {
  return DOMPurify.sanitize(markdownToHtml(source, context));
}

/** HTML aus Mails (serverseitig bereits bereinigt) zusätzlich im Browser bereinigen. */
export function renderMailHtml(html: string): string {
  return DOMPurify.sanitize(html, { FORBID_TAGS: ['style', 'form', 'input', 'button'], FORBID_ATTR: ['style'] });
}
