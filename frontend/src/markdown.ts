import DOMPurify from 'dompurify';
import MarkdownIt from 'markdown-it';

const md = new MarkdownIt({ html: false, linkify: true, breaks: true });

// Links in neuem Tab öffnen
DOMPurify.addHook('afterSanitizeAttributes', (node) => {
  if (node.tagName === 'A') {
    node.setAttribute('target', '_blank');
    node.setAttribute('rel', 'noopener noreferrer nofollow');
  }
});

export function renderMarkdown(source: string): string {
  return DOMPurify.sanitize(md.render(source));
}

/** HTML aus Mails (serverseitig bereits bereinigt) zusätzlich im Browser bereinigen. */
export function renderMailHtml(html: string): string {
  return DOMPurify.sanitize(html, { FORBID_TAGS: ['style', 'form', 'input', 'button'], FORBID_ATTR: ['style'] });
}
