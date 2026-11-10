import MsgReader, { type FieldsData } from '@kenjiuno/msgreader';
import { simpleParser, type AddressObject } from 'mailparser';
import { createHash } from 'node:crypto';
import nodemailer, { type SendMailOptions } from 'nodemailer';

/**
 * Outlook-Mails (.msg) für den Import (Entscheid vom 10.11.2026): Umwandlung in eine gewöhnliche Mail (MIME), die
 * dann wie eine abgerufene verarbeitet wird. Bei empfangenen Mails haben die Kopfzeilen der Übermittlung Vorrang
 * (Absender, Empfänger, Datum, Message-ID für die Zuordnung und gegen Doppelte); Text, HTML und Anhänge kommen aus der
 * .msg selbst.
 */

/** Kopfzeilen der ursprünglichen Mail, die die Verarbeitung braucht (automatische Mails, Newsletter) */
const KEPT_HEADERS = ['auto-submitted', 'precedence', 'x-autoreply', 'x-autorespond', 'list-id', 'list-unsubscribe'];

const CFB_MAGIC = Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]);

/** Outlook-Datei (Compound File), erkannt am Inhalt */
export const isMsgFile = (data: Buffer) => data.subarray(0, 8).equals(CFB_MAGIC);

/** Eine gewöhnliche Mail (MIME): beginnt mit Kopfzeilen wie «From:» oder «Received:» */
export const looksLikeMail = (data: Buffer) => /^(?:[\w-]+:[^\r\n]*\r?\n(?:[ \t][^\r\n]*\r?\n)*)+/.test(data.subarray(0, 4096).toString('latin1'));

/** SMTP-Adresse: Exchange-Adressen («/O=…») und Leeres zählen nicht */
const smtp = (...candidates: (string | undefined)[]) => candidates.find((c) => !!c && c.includes('@') && !c.trim().startsWith('/'))?.trim();

const list = (field: AddressObject | AddressObject[] | undefined) =>
  (Array.isArray(field) ? field : field ? [field] : [])
    .flatMap((a) => a.value)
    .filter((v) => !!v.address)
    .map((v) => ({ name: v.name ?? '', address: v.address! }));

const validDate = (d: Date | undefined | null) => (d && !Number.isNaN(d.getTime()) ? d : undefined);

/** HTML aus der .msg (Bytes) mit dem Zeichensatz aus dem Dokument, sonst UTF-8 */
function decodeHtml(bytes: Uint8Array): string {
  const head = Buffer.from(bytes.subarray(0, 2048)).toString('latin1');
  const charset = /charset\s*=\s*["']?([\w-]+)/i.exec(head)?.[1]?.toLowerCase() ?? 'utf-8';
  try {
    return new TextDecoder(charset).decode(bytes);
  } catch {
    return new TextDecoder('utf-8').decode(bytes);
  }
}

export interface MsgAttachment {
  filename: string;
  content: Buffer;
  contentType?: string;
  /** Content-ID eines eingebetteten Bilds */
  contentId?: string;
}

/**
 * Felder einer .msg (wie MsgReader sie liefert) als Mail für nodemailer. «hash»: Prüfsumme der Datei für die
 * Message-ID, falls die Mail keine hat (z.B. ohne Kopfzeilen der Übermittlung): dieselbe Datei erhält dieselbe.
 */
export async function msgFieldsToMail(msg: FieldsData, files: MsgAttachment[], hash: string): Promise<SendMailOptions> {
  const head = msg.headers?.trim() ? await simpleParser(Buffer.from(`${msg.headers.trim()}\r\n\r\n`, 'utf8')) : null;
  const recipients = (type: 'to' | 'cc') =>
    (msg.recipients ?? [])
      .filter((r) => (r.recipType ?? 'to') === type)
      .map((r) => ({ name: r.name ?? '', address: smtp(r.smtpAddress, r.email) ?? '' }))
      .filter((r) => r.address);
  const senderAddress = smtp(msg.senderSmtpAddress, msg.senderEmail);
  const from = list(head?.from)[0] ?? (senderAddress ? { name: msg.senderName ?? '', address: senderAddress } : undefined);
  const headTo = list(head?.to);
  const headCc = list(head?.cc);
  const html = msg.bodyHtml ?? (msg.html ? decodeHtml(msg.html) : undefined);
  const kept = Object.fromEntries(
    (head?.headerLines ?? []).filter((l) => KEPT_HEADERS.includes(l.key)).map((l) => [l.key, l.line.slice(l.line.indexOf(':') + 1).trim()]),
  );
  const date =
    validDate(head?.date) ??
    validDate(msg.clientSubmitTime ? new Date(msg.clientSubmitTime) : null) ??
    validDate(msg.messageDeliveryTime ? new Date(msg.messageDeliveryTime) : null);
  return {
    ...(from ? { from } : {}),
    to: headTo.length ? headTo : recipients('to'),
    cc: headCc.length ? headCc : recipients('cc'),
    subject: msg.subject ?? head?.subject ?? '',
    ...(date ? { date } : {}),
    messageId: head?.messageId ?? `<msg.${hash}@patchwork>`,
    ...(head?.inReplyTo ? { inReplyTo: head.inReplyTo } : {}),
    ...(head?.references ? { references: head.references } : {}),
    text: msg.body ?? '',
    ...(html ? { html } : {}),
    headers: kept,
    attachments: files.map((f) => ({
      filename: f.filename,
      content: f.content,
      ...(f.contentType ? { contentType: f.contentType } : {}),
      ...(f.contentId ? { cid: f.contentId } : {}),
      contentDisposition: f.contentId && html?.includes(`cid:${f.contentId}`) ? ('inline' as const) : ('attachment' as const),
    })),
  };
}

/** .msg in eine gewöhnliche Mail (MIME) umwandeln. Nicht lesbare Anhänge fallen weg. */
export async function msgToEml(data: Buffer): Promise<Buffer> {
  const reader = new MsgReader(new Uint8Array(data).buffer);
  const msg = reader.getFileData();
  if (msg.error) throw new Error(`Die Outlook-Datei lässt sich nicht lesen: ${msg.error}`);
  const files: MsgAttachment[] = [];
  for (const attachment of msg.attachments ?? []) {
    try {
      const file = reader.getAttachment(attachment);
      files.push({
        filename: file.fileName || 'anhang',
        content: Buffer.from(file.content),
        contentType: attachment.attachMimeTag || undefined,
        contentId: attachment.pidContentId?.replace(/^<|>$/g, '') || undefined,
      });
    } catch {
      // z.B. eingebettete Objekte ohne Datei
    }
  }
  const options = await msgFieldsToMail(msg, files, createHash('sha256').update(data).digest('hex'));
  const built = await nodemailer.createTransport({ streamTransport: true, buffer: true }).sendMail(options);
  return built.message as Buffer;
}
