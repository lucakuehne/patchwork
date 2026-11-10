import { simpleParser } from 'mailparser';
import nodemailer from 'nodemailer';
import { describe, expect, it } from 'vitest';
import type { FieldsData } from '@kenjiuno/msgreader';
import { isMsgFile, looksLikeMail, msgFieldsToMail, msgToEml } from './msg-mail';

/** Fertige Mail aus den Feldern einer .msg, wieder eingelesen wie beim Abruf */
async function roundTrip(fields: Partial<FieldsData>, files: Parameters<typeof msgFieldsToMail>[1] = []) {
  const options = await msgFieldsToMail(fields as FieldsData, files, 'abc123');
  const built = await nodemailer.createTransport({ streamTransport: true, buffer: true }).sendMail(options);
  return simpleParser(built.message as Buffer);
}

describe('Outlook-Mails (.msg) importieren', () => {
  it('Kopfzeilen der Übermittlung haben Vorrang: Absender, Empfänger, Datum, Message-ID, Antwort-Bezug', async () => {
    const mail = await roundTrip({
      subject: 'Drucker druckt nicht',
      senderName: 'Anna Muster',
      // Exchange-Adresse: zählt nicht als Absender
      senderEmail: '/O=EXCHANGELABS/OU=EXCHANGE ADMINISTRATIVE GROUP/CN=RECIPIENTS/CN=ANNA',
      headers:
        'From: =?utf-8?Q?Anna_M=C3=BCller?= <anna@firma.test>\r\nTo: Ivan <ivan@firma.test>\r\nCc: bob@firma.test\r\n' +
        'Date: Mon, 09 Nov 2026 17:42:00 +0100\r\nMessage-ID: <orig-1@firma.test>\r\nIn-Reply-To: <pw.123@patchwork.test>\r\n' +
        'References: <pw.123@patchwork.test>\r\nAuto-Submitted: auto-replied\r\nSubject: anders',
      body: 'Seit heute druckt er leer.',
      recipients: [{ recipType: 'to', name: 'Falsch', email: 'falsch@firma.test' } as FieldsData],
    });
    expect(mail.from?.value[0]).toEqual({ name: 'Anna Müller', address: 'anna@firma.test' });
    expect(mail.to && !Array.isArray(mail.to) ? mail.to.value.map((v) => v.address) : []).toEqual(['ivan@firma.test']);
    expect(mail.cc && !Array.isArray(mail.cc) ? mail.cc.value.map((v) => v.address) : []).toEqual(['bob@firma.test']);
    expect(mail.date?.toISOString()).toBe('2026-11-09T16:42:00.000Z');
    expect(mail.messageId).toBe('<orig-1@firma.test>');
    expect(mail.inReplyTo).toBe('<pw.123@patchwork.test>');
    // Betreff aus der .msg, automatische Mail bleibt erkennbar
    expect(mail.subject).toBe('Drucker druckt nicht');
    expect(mail.headers.get('auto-submitted')).toBe('auto-replied');
    expect(mail.text?.trim()).toBe('Seit heute druckt er leer.');
  });

  it('ohne Kopfzeilen: Absender und Empfänger aus der .msg (SMTP-Adressen), Message-ID aus der Prüfsumme', async () => {
    const mail = await roundTrip({
      subject: 'Entwurf',
      senderName: 'Anna Muster',
      senderEmail: '/O=EXCHANGELABS/CN=ANNA',
      senderSmtpAddress: 'anna@firma.test',
      clientSubmitTime: 'Mon, 09 Nov 2026 16:42:00 GMT',
      bodyHtml: '<p>Hallo <b>IT</b></p><img src="cid:bild1">',
      recipients: [
        { recipType: 'to', name: 'Ivan', email: '/O=EX/CN=IVAN', smtpAddress: 'ivan@firma.test' } as FieldsData,
        { recipType: 'cc', name: 'Bob', email: 'bob@firma.test' } as FieldsData,
        { recipType: 'cc', name: 'Ohne SMTP', email: '/O=EX/CN=X' } as FieldsData,
      ],
    }, [
      { filename: 'bild.png', content: Buffer.from('png'), contentType: 'image/png', contentId: 'bild1' },
      { filename: 'Rechnung.pdf', content: Buffer.from('pdf'), contentType: 'application/pdf' },
    ]);
    expect(mail.from?.value[0]).toEqual({ name: 'Anna Muster', address: 'anna@firma.test' });
    expect(mail.to && !Array.isArray(mail.to) ? mail.to.value.map((v) => v.address) : []).toEqual(['ivan@firma.test']);
    expect(mail.cc && !Array.isArray(mail.cc) ? mail.cc.value.map((v) => v.address) : []).toEqual(['bob@firma.test']);
    expect(mail.messageId).toBe('<msg.abc123@patchwork>');
    expect(mail.date?.toISOString()).toBe('2026-11-09T16:42:00.000Z');
    expect(mail.html).toContain('Hallo <b>IT</b>');
    expect(mail.attachments.map((a) => [a.filename, a.contentDisposition, a.cid ?? null])).toEqual([
      ['bild.png', 'inline', 'bild1'],
      ['Rechnung.pdf', 'attachment', null],
    ]);
  });

  it('erkennt .msg und .eml am Inhalt; eine beschädigte .msg meldet einen Fehler', async () => {
    const cfb = Buffer.concat([Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]), Buffer.alloc(504)]);
    expect(isMsgFile(cfb)).toBe(true);
    expect(isMsgFile(Buffer.from('From: a@b.test\r\n'))).toBe(false);
    expect(looksLikeMail(Buffer.from('Received: from x\r\n by y\r\nFrom: a@b.test\r\nSubject: Hallo\r\n\r\nText'))).toBe(true);
    expect(looksLikeMail(Buffer.from('%PDF-1.7\n'))).toBe(false);
    await expect(msgToEml(cfb)).rejects.toThrow();
  });
});
