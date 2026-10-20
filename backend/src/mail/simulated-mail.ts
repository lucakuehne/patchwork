import { randomUUID } from 'node:crypto';
import nodemailer from 'nodemailer';
import { appConfig } from '../config';

/** Kennzeichen simulierter Mails im Kopf (Wert: Adresse des Admins, der simuliert hat) */
export const SIMULATED_HEADER = 'x-patchwork-simulated';

export interface SimulatedMail {
  from: { address: string; name: string };
  /** Adresse des Postfachs */
  to: string;
  subject: string;
  text: string;
  /** Wie eine Abwesenheitsnotiz gekennzeichnet («Auto-Submitted: auto-replied») */
  automated?: boolean;
  attachments?: { filename: string; contentType: string; content: Buffer }[];
  /** Antwort: Message-ID der beantworteten Mail und deren Verweise */
  inReplyTo?: { messageId: string; references: string[] };
  simulatedBy: string;
  date?: Date;
}

/** Fertige Mail (MIME), wie sie ein Mailprogramm schicken würde, mit eigener Message-ID. */
export async function buildSimulatedMail(mail: SimulatedMail): Promise<{ raw: Buffer; messageId: string }> {
  const messageId = `<sim.${randomUUID()}@patchwork.invalid>`;
  const built = await nodemailer.createTransport({ streamTransport: true, buffer: true }).sendMail({
    from: mail.from.name ? { name: mail.from.name, address: mail.from.address } : mail.from.address,
    to: mail.to,
    subject: mail.subject,
    text: mail.text,
    messageId,
    date: mail.date ?? new Date(),
    ...(mail.inReplyTo
      ? { inReplyTo: mail.inReplyTo.messageId, references: [...mail.inReplyTo.references, mail.inReplyTo.messageId].slice(-20) }
      : {}),
    headers: {
      'X-Patchwork-Simulated': mail.simulatedBy,
      ...(mail.automated ? { 'Auto-Submitted': 'auto-replied' } : {}),
    },
    attachments: mail.attachments,
  });
  return { raw: built.message as Buffer, messageId };
}

/** Betreff einer Antwort, wie Outlook ihn schreibt. */
export function replySubject(subject: string): string {
  return /^\s*(AW|RE|WG|FW)\s*:/i.test(subject) ? subject : `AW: ${subject}`;
}

/** Text einer Antwort mit der ursprünglichen Mail darunter, zitiert wie in Outlook. */
export function replyText(
  text: string,
  original: { from: string; date: Date; to: string[]; cc: string[]; subject: string; text: string },
): string {
  const date = new Intl.DateTimeFormat('de-CH', { dateStyle: 'full', timeStyle: 'short', timeZone: appConfig.timeZone }).format(
    original.date,
  );
  return [
    text.trim(),
    '',
    '________________________________',
    `Von: ${original.from}`,
    `Gesendet: ${date}`,
    `An: ${original.to.join('; ')}`,
    ...(original.cc.length ? [`Cc: ${original.cc.join('; ')}`] : []),
    `Betreff: ${original.subject}`,
    '',
    original.text.trim(),
  ].join('\n');
}
