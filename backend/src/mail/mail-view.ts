import type { Response } from 'express';
import { simpleParser, type ParsedMail } from 'mailparser';
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
      from: parsed.from?.text ?? '',
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

/** Anhang einer gespeicherten Mail ausliefern, immer als Download und in einer Sandbox. */
export function sendMailAttachment(parsed: ParsedMail, index: number, res: Response): boolean {
  const attachment = parsed.attachments[index];
  if (!attachment) return false;
  res.setHeader('Content-Type', attachment.contentType || 'application/octet-stream');
  res.setHeader('Content-Disposition', disposition(attachment.filename ?? `Anhang ${index + 1}`));
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Content-Security-Policy', "default-src 'none'; sandbox");
  res.send(attachment.content);
  return true;
}
