/**
 * Bilder im Text (Markdown): «![Name](upload:<id>)» ist frisch im Editor hochgeladen, «![Name](attachment:<id>)» ein
 * eingebetteter Anhang des Vorgangs. Die Anzeige macht daraus je nach Ort eine Adresse (Patchwork, Portal, Mail).
 */
const UUID = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}';
const IMAGE = new RegExp(`!\\[([^\\]\\n]*)\\]\\((upload|attachment):(${UUID})\\)`, 'g');

export interface ImageRef {
  alt: string;
  kind: 'upload' | 'attachment';
  id: string;
}

export function imageRefs(markdown: string): ImageRef[] {
  return [...markdown.matchAll(IMAGE)].map((m) => ({ alt: m[1]!, kind: m[2] as ImageRef['kind'], id: m[3]! }));
}

/** Ersetzt Bilder; null lässt das Bild unverändert. */
export function replaceImages(markdown: string, replace: (ref: ImageRef) => string | null): string {
  return markdown.replace(IMAGE, (all, alt: string, kind: ImageRef['kind'], id: string) => replace({ alt, kind, id }) ?? all);
}

/** Für reinen Text (z.B. Benachrichtigungen, Textfassung von Mails): «[Bild: Name]». */
export function imagesAsText(markdown: string): string {
  return replaceImages(markdown, (ref) => `[Bild: ${ref.alt.trim() || 'Bild'}]`);
}

/** Erlaubte Bildformate für Bilder im Text, erkannt am Dateiinhalt. */
export function sniffImage(data: Buffer): 'image/png' | 'image/jpeg' | 'image/gif' | 'image/webp' | null {
  if (data.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'image/png';
  if (data[0] === 0xff && data[1] === 0xd8 && data[2] === 0xff) return 'image/jpeg';
  if (data.subarray(0, 4).toString('latin1') === 'GIF8') return 'image/gif';
  if (data.subarray(0, 4).toString('latin1') === 'RIFF' && data.subarray(8, 12).toString('latin1') === 'WEBP') return 'image/webp';
  return null;
}

/** Höchstgrösse eines Bilds im Text; grössere Dateien gehen als Anhang. */
export const MAX_IMAGE_BYTES = 10 * 1024 * 1024;

/** Formate, die als Bild im Text erscheinen dürfen */
export const TEXT_IMAGE_TYPES = new Set(['image/png', 'image/jpeg', 'image/gif', 'image/webp']);

/** Abmessungen aus dem Dateikopf (PNG, JPEG, GIF, WebP); null, wenn nicht lesbar. */
export function imageSize(data: Buffer): { width: number; height: number } | null {
  try {
    switch (sniffImage(data)) {
      case 'image/png':
        // Erster Block IHDR: Breite und Höhe ab Byte 16
        return { width: data.readUInt32BE(16), height: data.readUInt32BE(20) };
      case 'image/gif':
        return { width: data.readUInt16LE(6), height: data.readUInt16LE(8) };
      case 'image/jpeg':
        return jpegSize(data);
      case 'image/webp':
        return webpSize(data);
      default:
        return null;
    }
  } catch {
    // Abgeschnittene Datei
    return null;
  }
}

function jpegSize(data: Buffer): { width: number; height: number } | null {
  let offset = 2;
  while (offset + 9 < data.length) {
    if (data[offset] !== 0xff) return null;
    const marker = data[offset + 1]!;
    if (marker === 0xff) {
      // Füllbyte
      offset++;
      continue;
    }
    // Bildkopf (SOF0 bis SOF15, ohne DHT, JPG und DAC): Höhe, dann Breite
    if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
      return { height: data.readUInt16BE(offset + 5), width: data.readUInt16BE(offset + 7) };
    }
    // Marker ohne Länge
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd8)) {
      offset += 2;
      continue;
    }
    offset += 2 + data.readUInt16BE(offset + 2);
  }
  return null;
}

function webpSize(data: Buffer): { width: number; height: number } | null {
  switch (data.subarray(12, 16).toString('latin1')) {
    case 'VP8 ':
      return { width: data.readUInt16LE(26) & 0x3fff, height: data.readUInt16LE(28) & 0x3fff };
    case 'VP8L': {
      const bits = data.readUInt32LE(21);
      return { width: (bits & 0x3fff) + 1, height: ((bits >>> 14) & 0x3fff) + 1 };
    }
    case 'VP8X':
      return { width: data.readUIntLE(24, 3) + 1, height: data.readUIntLE(27, 3) + 1 };
    default:
      return null;
  }
}

/** Bild im Text einer Mail: eingebetteter Teil («cid»), Adresse in voller Grösse und Abmessungen. */
export interface EmbeddedImage {
  cid: string;
  url: string;
  width: number | null;
  height: number | null;
}

/** Breite des Texts in Mails (siehe htmlMail) */
export const MAIL_TEXT_WIDTH = 680;

/**
 * Bilder im HTML einer Mail (aus Markdown): eigene Bilder eingebettet («cid:»), auf Textbreite verkleinert und mit
 * Link auf die volle Grösse. Alle anderen Bilder werden nicht geladen, an ihrer Stelle steht «[Bild: Name]».
 */
export function embedImageTags(html: string, images: Map<string, EmbeddedImage>): string {
  return html.replace(/<img\b[^>]*>/g, (tag: string, offset: number) => {
    // Der Alternativtext ist im HTML bereits maskiert
    const alt = /\balt="([^"]*)"/.exec(tag)?.[1] ?? '';
    const id = /\bsrc="attachment:([0-9a-f-]{36})"/.exec(tag)?.[1];
    const image = id ? images.get(id) : undefined;
    if (!image) return `[Bild: ${alt.trim() || 'Bild'}]`;
    // Outlook kennt kein max-width: grosse Bilder zusätzlich über width und height verkleinern
    const size =
      image.width && image.height && image.width > MAIL_TEXT_WIDTH
        ? ` width="${MAIL_TEXT_WIDTH}" height="${Math.round((image.height * MAIL_TEXT_WIDTH) / image.width)}"`
        : '';
    const img = `<img src="cid:${image.cid}" alt="${alt}"${size} border="0" style="max-width:100%;height:auto;border:0">`;
    // Steht das Bild schon in einem Link, bleibt es bei diesem
    const insideLink = html.lastIndexOf('<a ', offset) > html.lastIndexOf('</a>', offset);
    return insideLink ? img : `<a href="${image.url}" target="_blank">${img}</a>`;
  });
}
