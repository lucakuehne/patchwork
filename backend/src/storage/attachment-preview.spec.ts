import { describe, expect, it } from 'vitest';
import { buildPreview, decodeText, inlineType, nestedAttachment, previewKind } from './attachment-preview';

const file = (filename: string, contentType: string, content = Buffer.from('')) => ({ filename, contentType, content });

describe('Vorschau von Anhängen', () => {
  it('Art nach Typ und Endung', () => {
    expect(previewKind(file('bild.png', 'image/png'))).toBe('image');
    expect(previewKind(file('logo.svg', 'image/svg+xml'))).toBe('image');
    expect(previewKind(file('Rechnung.pdf', 'application/octet-stream'))).toBe('pdf');
    expect(previewKind(file('setup.log', 'application/octet-stream'))).toBe('text');
    expect(previewKind(file('daten', 'text/csv; charset=utf-8'))).toBe('text');
    expect(previewKind(file('config.yaml', 'application/x-yaml'))).toBe('text');
    expect(previewKind(file('Weiterleitung.eml', 'application/octet-stream'))).toBe('mail');
    expect(previewKind(file('Outlook.msg', 'application/vnd.ms-outlook'))).toBe('mail');
    expect(previewKind(file('Bericht.docx', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'))).toBeNull();
    expect(previewKind(file('archiv.zip', 'application/zip'))).toBeNull();
  });

  it('inline nur Bilder und PDF', () => {
    expect(inlineType(file('bild.PNG', 'IMAGE/PNG'))).toBe('image/png');
    expect(inlineType(file('Rechnung.pdf', 'application/octet-stream'))).toBe('application/pdf');
    expect(inlineType(file('setup.log', 'text/plain'))).toBeNull();
  });

  it('Text in UTF-8, UTF-16 und Windows-1252', () => {
    expect(decodeText(Buffer.from('Grüsse ✓', 'utf8'))).toBe('Grüsse ✓');
    expect(decodeText(Buffer.from([0xef, 0xbb, 0xbf, 0x41]))).toBe('A');
    expect(decodeText(Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from('Grüsse', 'utf16le')]))).toBe('Grüsse');
    expect(decodeText(Buffer.from([0x47, 0x72, 0xfc, 0x73, 0x73, 0x65, 0x80]))).toBe('Grüsse€');
  });

  it('Text gekürzt, unbekannte Typen ohne Vorschau', async () => {
    expect(await buildPreview(file('a.txt', 'text/plain', Buffer.from('Zeile 1\nZeile 2')))).toEqual({
      kind: 'text',
      text: 'Zeile 1\nZeile 2',
      truncated: false,
    });
    expect((await buildPreview(file('gross.log', 'text/plain', Buffer.alloc(1_000_010, 'x'))))?.truncated).toBe(true);
    expect(await buildPreview(file('bild.png', 'image/png'))).toEqual({ kind: 'image' });
    expect(await buildPreview(file('a.zip', 'application/zip'))).toBeNull();
  });

  it('Mail (.eml): Kopf, bereinigtes HTML mit eingebettetem Bild, Anhänge', async () => {
    const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');
    const eml = [
      'From: Anna Muster <anna@firma.ch>',
      'To: helpdesk@firma.ch',
      'Subject: Weitergeleitet',
      'Date: Thu, 22 Oct 2026 10:00:00 +0200',
      'MIME-Version: 1.0',
      'Content-Type: multipart/mixed; boundary="aussen"',
      '',
      '--aussen',
      'Content-Type: multipart/related; boundary="innen"',
      '',
      '--innen',
      'Content-Type: text/html; charset=utf-8',
      '',
      '<p>Hallo<script>alert(1)</script></p><span><img src="cid:bild1@x"></span>',
      '--innen',
      'Content-Type: image/png',
      'Content-ID: <bild1@x>',
      'Content-Disposition: inline; filename="bild.png"',
      'Content-Transfer-Encoding: base64',
      '',
      png.toString('base64'),
      '--innen--',
      '--aussen',
      'Content-Type: text/plain; name="log.txt"',
      'Content-Disposition: attachment; filename="log.txt"',
      '',
      'Logdatei',
      '--aussen--',
      '',
    ].join('\r\n');
    const preview = await buildPreview(file('Weiterleitung.eml', 'message/rfc822', Buffer.from(eml)));
    expect(preview?.kind).toBe('mail');
    expect(preview?.mail?.headers).toMatchObject({ from: 'Anna Muster <anna@firma.ch>', to: ['helpdesk@firma.ch'], subject: 'Weitergeleitet' });
    expect(preview?.mail?.html).toContain('src="data:image/png;base64,');
    expect(preview?.mail?.html).not.toContain('script');
    expect(preview?.mail?.attachments.map((a) => a.filename)).toEqual(['bild.png', 'log.txt']);
    const nested = await nestedAttachment(file('Weiterleitung.eml', 'message/rfc822', Buffer.from(eml)), 1);
    expect(nested?.content.toString().trim()).toBe('Logdatei');
    expect(await nestedAttachment(file('a.txt', 'text/plain', Buffer.from('x')), 0)).toBeNull();
  });
});
