import { describe, expect, it } from 'vitest';
import { renderMarkdown } from '../mail/mail-content';
import {
  embedImageTags,
  imageRefs,
  imagesAsText,
  imageSize,
  replaceImages,
  sniffImage,
  type EmbeddedImage,
} from './inline-images';

const ID = '0b1e8f2a-1c3d-4e5f-8a9b-0c1d2e3f4a5b';
const OTHER = '9f8e7d6c-5b4a-4321-8fed-cba987654321';

const u16be = (n: number) => Buffer.from([n >> 8, n & 0xff]);
const u16le = (n: number) => Buffer.from([n & 0xff, n >> 8]);
const u32be = (n: number) => {
  const b = Buffer.alloc(4);
  b.writeUInt32BE(n);
  return b;
};
const u24le = (n: number) => Buffer.from([n & 0xff, (n >> 8) & 0xff, (n >> 16) & 0xff]);

const png = (w: number, h: number) =>
  Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    u32be(13),
    Buffer.from('IHDR'),
    u32be(w),
    u32be(h),
    Buffer.from([8, 6, 0, 0, 0]),
  ]);
const gif = (w: number, h: number) => Buffer.concat([Buffer.from('GIF89a'), u16le(w), u16le(h), Buffer.alloc(8)]);
// JPEG mit APP0-Block vor dem Bildkopf (SOF0)
const jpeg = (w: number, h: number) =>
  Buffer.concat([
    Buffer.from([0xff, 0xd8]),
    Buffer.from([0xff, 0xe0]),
    u16be(16),
    Buffer.alloc(14),
    Buffer.from([0xff, 0xc0]),
    u16be(17),
    Buffer.from([8]),
    u16be(h),
    u16be(w),
    Buffer.alloc(10),
  ]);
const webpX = (w: number, h: number) =>
  Buffer.concat([Buffer.from('RIFF'), Buffer.alloc(4), Buffer.from('WEBPVP8X'), Buffer.alloc(8), u24le(w - 1), u24le(h - 1)]);

describe('imageRefs und replaceImages', () => {
  it('findet Bilder im Text, aber keine Links', () => {
    const text = `![Fehler.png](upload:${ID}) und [Link](attachment:${OTHER}) und ![b](attachment:${OTHER})`;
    expect(imageRefs(text)).toEqual([
      { alt: 'Fehler.png', kind: 'upload', id: ID },
      { alt: 'b', kind: 'attachment', id: OTHER },
    ]);
  });

  it('ersetzt Bilder und lässt die übrigen stehen', () => {
    const text = `![a](upload:${ID}) ![b](attachment:${OTHER})`;
    expect(replaceImages(text, (ref) => (ref.kind === 'upload' ? `![${ref.alt}](attachment:${OTHER})` : null))).toBe(
      `![a](attachment:${OTHER}) ![b](attachment:${OTHER})`,
    );
  });

  it('zeigt Bilder im reinen Text als «[Bild: Name]»', () => {
    expect(imagesAsText(`Siehe ![Fehler.png](attachment:${ID}) und ![](upload:${ID})`)).toBe('Siehe [Bild: Fehler.png] und [Bild: Bild]');
  });
});

describe('sniffImage und imageSize', () => {
  it('erkennt die Formate am Inhalt', () => {
    expect(sniffImage(png(1, 1))).toBe('image/png');
    expect(sniffImage(jpeg(1, 1))).toBe('image/jpeg');
    expect(sniffImage(gif(1, 1))).toBe('image/gif');
    expect(sniffImage(webpX(1, 1))).toBe('image/webp');
    expect(sniffImage(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>'))).toBeNull();
  });

  it('liest die Abmessungen aus dem Dateikopf', () => {
    expect(imageSize(png(1920, 1080))).toEqual({ width: 1920, height: 1080 });
    expect(imageSize(jpeg(3024, 4032))).toEqual({ width: 3024, height: 4032 });
    expect(imageSize(gif(320, 200))).toEqual({ width: 320, height: 200 });
    expect(imageSize(webpX(2560, 1440))).toEqual({ width: 2560, height: 1440 });
  });

  it('gibt bei abgeschnittenen oder fremden Dateien null zurück', () => {
    expect(imageSize(png(10, 10).subarray(0, 18))).toBeNull();
    expect(imageSize(Buffer.from('kein Bild'))).toBeNull();
  });
});

describe('embedImageTags', () => {
  const image = (width: number | null, height: number | null): EmbeddedImage => ({
    cid: 'abc@patchwork',
    url: `https://pw.test/api/public/images/${ID}?s=sig`,
    width,
    height,
  });

  it('bettet eigene Bilder ein, mit Link auf die volle Grösse', () => {
    const html = embedImageTags(renderMarkdown(`![Fehler.png](attachment:${ID})`), new Map([[ID, image(400, 300)]]));
    expect(html).toContain(`<a href="https://pw.test/api/public/images/${ID}?s=sig" target="_blank">`);
    expect(html).toContain('<img src="cid:abc@patchwork" alt="Fehler.png" border="0" style="max-width:100%;height:auto;border:0">');
  });

  it('verkleinert breite Bilder auch für Outlook auf die Textbreite', () => {
    const html = embedImageTags(renderMarkdown(`![a](attachment:${ID})`), new Map([[ID, image(1920, 1080)]]));
    expect(html).toContain('width="680" height="383"');
  });

  it('lädt fremde und unbekannte Bilder nicht', () => {
    const html = embedImageTags(
      renderMarkdown(`![Logo](https://example.com/logo.png) ![x](attachment:${OTHER})`),
      new Map([[ID, image(10, 10)]]),
    );
    expect(html).not.toContain('<img');
    expect(html).toContain('[Bild: Logo] [Bild: x]');
  });

  it('setzt in einem Link keinen zweiten Link', () => {
    const html = embedImageTags(renderMarkdown(`[![a](attachment:${ID})](https://example.com)`), new Map([[ID, image(10, 10)]]));
    expect(html.match(/<a /g)).toHaveLength(1);
    expect(html).toContain('src="cid:abc@patchwork"');
  });
});
