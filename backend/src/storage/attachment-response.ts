import type { Response } from 'express';
import type { Attachment } from '../db/schema';
import type { StorageService } from './storage.service';

/**
 * Liefert einen Anhang aus. Inline nur für Bilder (Vorschau, eingebettete Mail-Bilder),
 * alle anderen Typen werden heruntergeladen. Inhalte laufen in einer Sandbox.
 */
export function sendAttachment(storage: StorageService, att: Attachment, res: Response, inline: boolean) {
  const isImage = /^image\/(png|jpe?g|gif|webp|bmp)$/i.test(att.contentType);
  const disposition = inline && isImage ? 'inline' : 'attachment';
  res.setHeader('Content-Type', isImage || !inline ? att.contentType : 'application/octet-stream');
  res.setHeader(
    'Content-Disposition',
    `${disposition}; filename="${att.filename.replace(/[^\x20-\x7e]/g, '_').replace(/"/g, '')}"; filename*=UTF-8''${encodeURIComponent(att.filename)}`,
  );
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Content-Security-Policy', "default-src 'none'; sandbox");
  res.setHeader('Cache-Control', 'private, max-age=86400');
  storage
    .stream(att.storageKey)
    .on('error', () => res.status(404).end())
    .pipe(res);
}
