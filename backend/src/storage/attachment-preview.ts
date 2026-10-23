import MsgReader from '@kenjiuno/msgreader';
import type { Response } from 'express';
import { simpleParser, type AddressObject } from 'mailparser';
import { sanitizeMailHtml } from '../mail/mail-content';

/**
 * Vorschau von Anhängen in einem Fenster: Bilder und PDF zeigt der Browser selbst (inline ausgeliefert), Text und Mails
 * (.eml, Outlook-.msg) bereitet der Server auf. Übrige Typen werden heruntergeladen.
 */
export type PreviewKind = 'image' | 'text' | 'pdf' | 'mail';

export interface FileInfo {
  filename: string;
  contentType: string;
}

const IMAGE_TYPES = /^image\/(png|jpe?g|gif|webp|bmp|svg\+xml)$/i;
const TEXT_EXTENSIONS = /\.(txt|log|csv|json|xml|md|ini|cfg|conf|ya?ml)$/i;
const TEXT_TYPES = /^(text\/[\w.+-]+|application\/(json|xml|x-yaml|yaml))$/i;
/** Text höchstens so lang (Zeichen); längere werden gekürzt */
export const MAX_PREVIEW_TEXT = 1_000_000;
/** Eingebettete Bilder einer Mail in der Vorschau höchstens so gross (sonst fehlen sie) */
const MAX_INLINE_IMAGE = 3 * 1024 * 1024;

export function previewKind({ filename, contentType }: FileInfo): PreviewKind | null {
  const type = contentType.toLowerCase().split(';')[0]!.trim();
  const name = filename.toLowerCase();
  if (IMAGE_TYPES.test(type)) return 'image';
  if (type === 'application/pdf' || name.endsWith('.pdf')) return 'pdf';
  if (type === 'message/rfc822' || type === 'application/vnd.ms-outlook' || name.endsWith('.eml') || name.endsWith('.msg')) {
    return 'mail';
  }
  if (TEXT_TYPES.test(type) || TEXT_EXTENSIONS.test(name)) return 'text';
  return null;
}

/** Typ für die Anzeige im Browser (Bilder, PDF), sonst null = nur herunterladen */
export function inlineType(file: FileInfo): string | null {
  const kind = previewKind(file);
  if (kind === 'image') return file.contentType.split(';')[0]!.trim().toLowerCase();
  if (kind === 'pdf') return 'application/pdf';
  return null;
}

const disposition = (kind: 'inline' | 'attachment', filename: string) =>
  `${kind}; filename="${filename.replace(/[^\x20-\x7e]/g, '_').replace(/"/g, '')}"; filename*=UTF-8''${encodeURIComponent(filename)}`;

/**
 * Kopfzeilen für einen Anhang: inline nur Bilder und PDF, alles andere als Download. Bilder und Downloads laufen in einer
 * Sandbox; bei PDF nicht, weil der PDF-Betrachter des Browsers in einer Sandbox nicht startet.
 */
export function attachmentHeaders(res: Response, file: FileInfo, inline: boolean) {
  const type = inline ? inlineType(file) : null;
  res.setHeader('Content-Type', type ?? (inline ? 'application/octet-stream' : file.contentType || 'application/octet-stream'));
  res.setHeader('Content-Disposition', disposition(type ? 'inline' : 'attachment', file.filename));
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Content-Security-Policy', type === 'application/pdf' ? "default-src 'none'; frame-ancestors 'self'" : "default-src 'none'; sandbox");
}

export function sendFile(res: Response, file: FileInfo & { content: Buffer }, inline: boolean) {
  attachmentHeaders(res, file, inline);
  res.send(file.content);
}

export interface MailPreview {
  headers: { from: string; to: string[]; cc: string[]; subject: string; date: string | null };
  text: string;
  /** Bereinigtes HTML, eingebettete Bilder als data:-Adressen */
  html: string | null;
  attachments: { index: number; filename: string; contentType: string; size: number }[];
}

export interface AttachmentPreview {
  kind: PreviewKind;
  text?: string;
  /** Text gekürzt */
  truncated?: boolean;
  mail?: MailPreview;
}

/** Vorschau eines Anhangs: Bilder und PDF ohne Inhalt (die zeigt der Browser), Text und Mails aufbereitet. */
export async function buildPreview(file: FileInfo & { content: Buffer }): Promise<AttachmentPreview | null> {
  const kind = previewKind(file);
  if (!kind) return null;
  if (kind === 'text') {
    const text = decodeText(file.content);
    return { kind, text: text.slice(0, MAX_PREVIEW_TEXT), truncated: text.length > MAX_PREVIEW_TEXT };
  }
  if (kind === 'mail') {
    const mail = await readMailFile(file);
    return {
      kind,
      mail: {
        headers: mail.headers,
        text: mail.text,
        html: mail.html,
        attachments: mail.attachments.map((a, index) => ({ index, filename: a.filename, contentType: a.contentType, size: a.content.length })),
      },
    };
  }
  return { kind };
}

/** Anhang einer Mail, die selbst ein Anhang ist (.eml, .msg), z.B. zum Herunterladen aus der Vorschau */
export async function nestedAttachment(file: FileInfo & { content: Buffer }, index: number) {
  if (previewKind(file) !== 'mail') return null;
  return (await readMailFile(file)).attachments[index] ?? null;
}

/** Text in UTF-8 (mit oder ohne BOM), UTF-16 mit BOM, sonst Windows-1252 */
export function decodeText(content: Buffer): string {
  if (content[0] === 0xff && content[1] === 0xfe) return new TextDecoder('utf-16le').decode(content.subarray(2));
  if (content[0] === 0xfe && content[1] === 0xff) return new TextDecoder('utf-16be').decode(content.subarray(2));
  try {
    return new TextDecoder('utf-8', { fatal: true, ignoreBOM: false }).decode(content);
  } catch {
    return new TextDecoder('windows-1252').decode(content);
  }
}

interface MailFile {
  headers: MailPreview['headers'];
  text: string;
  html: string | null;
  attachments: { filename: string; contentType: string; content: Buffer; contentId: string | null }[];
}

/** Mail aus einer .eml- oder Outlook-.msg-Datei */
async function readMailFile(file: FileInfo & { content: Buffer }): Promise<MailFile> {
  const msg = file.filename.toLowerCase().endsWith('.msg') || file.contentType.toLowerCase() === 'application/vnd.ms-outlook';
  const mail = msg ? readMsg(file.content) : await readEml(file.content);
  // Eingebettete Bilder als data:-Adressen, damit die Vorschau sie ohne weitere Anfrage zeigt
  const images = new Map(
    mail.attachments
      .filter((a) => a.contentId && /^image\/(png|jpe?g|gif|webp)$/i.test(a.contentType) && a.content.length <= MAX_INLINE_IMAGE)
      .map((a) => [a.contentId!, `data:${a.contentType.toLowerCase()};base64,${a.content.toString('base64')}`]),
  );
  return { ...mail, html: mail.html ? sanitizeMailHtml(mail.html, images) : null };
}

async function readEml(content: Buffer): Promise<MailFile> {
  const parsed = await simpleParser(content, { keepCidLinks: true });
  const list = (field: AddressObject | AddressObject[] | undefined) =>
    [field ?? []].flat().flatMap((a) => a.value.map((v) => (v.name ? `${v.name} <${v.address}>` : (v.address ?? ''))));
  return {
    headers: {
      from: list(parsed.from).join(', '),
      to: list(parsed.to),
      cc: list(parsed.cc),
      subject: parsed.subject ?? '',
      date: parsed.date && !Number.isNaN(parsed.date.getTime()) ? parsed.date.toISOString() : null,
    },
    text: parsed.text ?? '',
    html: parsed.html || null,
    attachments: parsed.attachments.map((a, index) => ({
      filename: a.filename ?? `Anhang ${index + 1}`,
      contentType: a.contentType || 'application/octet-stream',
      content: a.content,
      contentId: (a.cid ?? a.contentId ?? '').replace(/^<|>$/g, '') || null,
    })),
  };
}

function readMsg(content: Buffer): MailFile {
  const reader = new MsgReader(content.buffer.slice(content.byteOffset, content.byteOffset + content.byteLength) as ArrayBuffer);
  const data = reader.getFileData();
  if ((data as { error?: string }).error) throw new Error('Die Outlook-Mail lässt sich nicht lesen');
  const person = (name?: string, email?: string) => (name && email && name !== email ? `${name} <${email}>` : (email ?? name ?? ''));
  const recipients = (type: 'to' | 'cc') =>
    (data.recipients ?? []).filter((r) => r.recipType === type).map((r) => person(r.name, r.smtpAddress ?? r.email));
  const date = data.messageDeliveryTime ?? data.clientSubmitTime ?? null;
  const html = data.bodyHtml ?? (data.html ? new TextDecoder('utf-8').decode(data.html) : null);
  return {
    headers: {
      from: person(data.senderName, data.senderSmtpAddress ?? data.senderEmail),
      to: recipients('to'),
      cc: recipients('cc'),
      subject: data.subject ?? '',
      date: date && !Number.isNaN(new Date(date).getTime()) ? new Date(date).toISOString() : null,
    },
    text: data.body ?? '',
    html: html || null,
    attachments: (data.attachments ?? []).map((a, index) => {
      const attachment = reader.getAttachment(a);
      return {
        filename: attachment.fileName || a.fileName || `Anhang ${index + 1}`,
        contentType: a.attachMimeTag || 'application/octet-stream',
        content: Buffer.from(attachment.content),
        contentId: a.pidContentId?.replace(/^<|>$/g, '') || null,
      };
    }),
  };
}
