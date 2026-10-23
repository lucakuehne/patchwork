import { describe, expect, it } from 'vitest';
import { mailAttachmentUrls, previewKind } from './attachment-preview';

describe('Vorschau von Anhängen', () => {
  it('Art wie im Backend', () => {
    const kind = (filename: string, contentType: string) => previewKind({ filename, contentType });
    expect(kind('a.jpg', 'image/jpeg')).toBe('image');
    expect(kind('Rechnung.PDF', 'application/octet-stream')).toBe('pdf');
    expect(kind('install.log', 'application/octet-stream')).toBe('text');
    expect(kind('x', 'text/plain; charset=utf-8')).toBe('text');
    expect(kind('Mail.msg', 'application/octet-stream')).toBe('mail');
    expect(kind('Mail', 'message/rfc822')).toBe('mail');
    expect(kind('Tabelle.xlsx', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')).toBeNull();
  });

  it('Adressen für Anhänge einer gespeicherten Mail', () => {
    expect(mailAttachmentUrls('/api/admin/incoming-mails/1/attachments/0')).toEqual({
      download: '/api/admin/incoming-mails/1/attachments/0',
      inline: '/api/admin/incoming-mails/1/attachments/0?inline=1',
      preview: '/api/admin/incoming-mails/1/attachments/0/preview',
    });
    expect(mailAttachmentUrls('/api/items/5/original/attachments/2', '?messageId=%3Cx%3E')).toEqual({
      download: '/api/items/5/original/attachments/2?messageId=%3Cx%3E',
      inline: '/api/items/5/original/attachments/2?messageId=%3Cx%3E&inline=1',
      preview: '/api/items/5/original/attachments/2/preview?messageId=%3Cx%3E',
    });
  });
});
