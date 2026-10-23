import type { Response } from 'express';
import type { Attachment } from '../db/schema';
import { attachmentHeaders } from './attachment-preview';
import type { StorageService } from './storage.service';

/**
 * Liefert einen Anhang aus. Inline nur für Bilder (Vorschau, eingebettete Mail-Bilder) und PDF (Vorschau),
 * alle anderen Typen werden heruntergeladen (siehe attachmentHeaders).
 */
export function sendAttachment(
  storage: StorageService,
  att: Pick<Attachment, 'filename' | 'contentType' | 'storageKey'>,
  res: Response,
  inline: boolean,
) {
  attachmentHeaders(res, att, inline);
  res.setHeader('Cache-Control', 'private, max-age=86400');
  storage
    .stream(att.storageKey)
    .on('error', () => res.status(404).end())
    .pipe(res);
}
