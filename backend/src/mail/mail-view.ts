import { NotFoundException } from '@nestjs/common';
import type { Response } from 'express';
import { simpleParser, type ParsedMail } from 'mailparser';
import { buildPreview, sendFile } from '../storage/attachment-preview';
import { sanitizeMailHtml } from './mail-content';

/** Dateiname für Content-Disposition: ASCII-Ersatz und UTF-8-Variante */
export const disposition = (filename: string) =>
  `attachment; filename="${filename.replace(/[^\x20-\x7e]/g, '_').replace(/"/g, '')}"; filename*=UTF-8''${encodeURIComponent(filename)}`;

/**
 * Gespeicherte Mail (.eml) für die Ansicht in der Verwaltung: Text, HTML und Anhänge. Eingebettete Bilder («cid:»)
 * zeigen auf die Anhänge der Mail. «untrusted»: fremdes HTML (eingehende Mails) wird bereinigt, externe Bilder fallen weg.
 */
export async function mailView(raw: Buffer, attachmentUrl: (index: number) => string, untrusted: boolean) {
  // Ohne keepCidLinks setzt mailparser die Bilder als data:-Adressen ins HTML
  const parsed = await simpleParser(raw, { keepCidLinks: true });
  const list = (field: ParsedMail['to']) => [field ?? []].flat().flatMap((a) => a.value.map((v) => (v.name ? `${v.name} <${v.address}>` : (v.address ?? ''))));
  const byCid = new Map(parsed.attachments.map((a, index) => [(a.cid ?? '').replace(/^<|>$/g, ''), attachmentUrl(index)]));
  let html: string | null = null;
  if (parsed.html) {
    html = untrusted
      ? sanitizeMailHtml(parsed.html, byCid)
      : parsed.html.replace(/src="cid:([^"]+)"/g, (all, cid: string) => (byCid.has(cid) ? `src="${byCid.get(cid)}"` : all));
  }
  return {
    headers: {
      from: list(parsed.from).join(', '),
      to: list(parsed.to),
      cc: list(parsed.cc),
      subject: parsed.subject ?? '',
      date: parsed.date && !Number.isNaN(parsed.date.getTime()) ? parsed.date.toISOString() : null,
    },
    text: parsed.text ?? '',
    html,
    attachments: parsed.attachments.map((a, index) => ({
      index,
      filename: a.filename ?? `Anhang ${index + 1}`,
      contentType: a.contentType,
      size: a.size,
    })),
  };
}

/** Anhang einer gespeicherten Mail als Datei (Name, Typ, Inhalt); null = nicht vorhanden */
export function mailAttachmentFile(parsed: ParsedMail, index: number) {
  const attachment = parsed.attachments[index];
  if (!attachment) return null;
  return {
    filename: attachment.filename ?? `Anhang ${index + 1}`,
    contentType: attachment.contentType || 'application/octet-stream',
    content: attachment.content,
  };
}

/**
 * Anhang einer gespeicherten Mail ausliefern: als Download in einer Sandbox, mit «inline» Bilder und PDF zur Anzeige
 * (Vorschau, siehe attachmentHeaders).
 */
export function sendMailAttachment(parsed: ParsedMail, index: number, res: Response, inline = false): boolean {
  const file = mailAttachmentFile(parsed, index);
  if (!file) return false;
  sendFile(res, file, inline);
  return true;
}

/** Vorschau eines Anhangs einer gespeicherten Mail (Text, Mail; Bilder und PDF zeigt der Browser) */
export async function mailAttachmentPreview(parsed: ParsedMail, index: number) {
  const file = mailAttachmentFile(parsed, index);
  if (!file) throw new NotFoundException('Anhang nicht gefunden');
  const preview = await buildPreview(file);
  if (!preview) throw new NotFoundException('Für diesen Dateityp gibt es keine Vorschau');
  return preview;
}
