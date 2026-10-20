import { describe, expect, it } from 'vitest';
import { imageRef, imagesInText, imageUrl, markdownToHtml } from './markdown-html';

const ID = '0b1e8f2a-1c3d-4e5f-8a9b-0c1d2e3f4a5b';
const OTHER = '9f8e7d6c-5b4a-4321-8fed-cba987654321';

describe('imageUrl', () => {
  it('zeigt frisch hochgeladene Bilder über den Upload an', () => {
    expect(imageUrl(`upload:${ID}`, 'staff')).toBe(`/api/uploads/${ID}`);
    expect(imageUrl(`upload:${ID}`, 'portal')).toBe(`/api/uploads/${ID}`);
  });

  it('nimmt für Anhänge die Adresse des Orts (Patchwork oder Portal)', () => {
    expect(imageUrl(`attachment:${ID}`, 'staff')).toBe(`/api/attachments/${ID}/inline`);
    expect(imageUrl(`attachment:${ID}`, 'portal')).toBe(`/api/portal/attachments/${ID}/inline`);
  });

  it('lehnt fremde Bilder ab', () => {
    expect(imageUrl('https://example.com/a.png', 'staff')).toBeNull();
    expect(imageUrl('attachment:keine-id', 'staff')).toBeNull();
  });
});

describe('imageRef', () => {
  it('erkennt Adressen von Patchwork, auch vollständige', () => {
    expect(imageRef(`https://pw.test/api/attachments/${ID}/inline`, 'https://pw.test')).toBe(`attachment:${ID}`);
    expect(imageRef(`/api/portal/attachments/${ID}/inline`, 'https://pw.test')).toBe(`attachment:${ID}`);
    expect(imageRef(`/api/uploads/${ID}`, 'https://pw.test')).toBe(`upload:${ID}`);
  });

  it('ignoriert fremde Server und andere Adressen', () => {
    expect(imageRef(`https://evil.test/api/attachments/${ID}/inline`, 'https://pw.test')).toBeNull();
    expect(imageRef(`https://pw.test/api/attachments/${ID}`, 'https://pw.test')).toBeNull();
    expect(imageRef('https://pw.test/logo.png', 'https://pw.test')).toBeNull();
  });
});

describe('imagesInText', () => {
  it('findet eingebettete Anhänge, aber keine Uploads und Links', () => {
    const text = `![a](attachment:${ID}) [Link](attachment:${OTHER}) ![b](upload:${OTHER})`;
    expect([...imagesInText(text)]).toEqual([ID]);
  });
});

describe('markdownToHtml', () => {
  it('zeigt eigene Bilder mit Link auf die volle Grösse', () => {
    const html = markdownToHtml(`Siehe:\n\n![Fehler.png](attachment:${ID})`, 'staff');
    expect(html).toContain(`<a href="/api/attachments/${ID}/inline" class="text-image-link"`);
    expect(html).toContain(`<img src="/api/attachments/${ID}/inline" alt="Fehler.png" class="text-image" loading="lazy">`);
  });

  it('nimmt im Portal die Adressen des Portals', () => {
    expect(markdownToHtml(`![x](attachment:${ID})`, 'portal')).toContain(`src="/api/portal/attachments/${ID}/inline"`);
  });

  it('lädt fremde Bilder nicht, sondern zeigt einen Link', () => {
    const html = markdownToHtml('![Logo](https://example.com/logo.png)', 'staff');
    expect(html).not.toContain('<img');
    expect(html).toContain('<a href="https://example.com/logo.png">Logo</a>');
  });

  it('setzt um ein verlinktes Bild keinen zweiten Link', () => {
    const html = markdownToHtml(`[![Bild](attachment:${ID})](https://example.com)`, 'staff');
    expect(html.match(/<a /g)).toHaveLength(1);
    expect(html).toContain(`<img src="/api/attachments/${ID}/inline"`);
  });

  it('maskiert den Alternativtext', () => {
    expect(markdownToHtml(`![a"b<c](attachment:${ID})`, 'staff')).toContain('alt="a&quot;b&lt;c"');
  });
});
