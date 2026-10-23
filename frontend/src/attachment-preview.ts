/**
 * Welche Anhänge sich im Fenster anzeigen lassen (wie im Backend, attachment-preview.ts): Bilder und PDF zeigt der
 * Browser, Text und Mails (.eml, .msg) bereitet der Server auf. Übrige Typen werden heruntergeladen.
 */
export type PreviewKind = 'image' | 'text' | 'pdf' | 'mail';

const IMAGE_TYPES = /^image\/(png|jpe?g|gif|webp|bmp|svg\+xml)$/i;
const TEXT_EXTENSIONS = /\.(txt|log|csv|json|xml|md|ini|cfg|conf|ya?ml)$/i;
const TEXT_TYPES = /^(text\/[\w.+-]+|application\/(json|xml|x-yaml|yaml))$/i;

export function previewKind(file: { filename: string; contentType: string }): PreviewKind | null {
  const type = file.contentType.toLowerCase().split(';')[0]!.trim();
  const name = file.filename.toLowerCase();
  if (IMAGE_TYPES.test(type)) return 'image';
  if (type === 'application/pdf' || name.endsWith('.pdf')) return 'pdf';
  if (type === 'message/rfc822' || type === 'application/vnd.ms-outlook' || name.endsWith('.eml') || name.endsWith('.msg')) {
    return 'mail';
  }
  if (TEXT_TYPES.test(type) || TEXT_EXTENSIONS.test(name)) return 'text';
  return null;
}

/** Adressen für das Vorschaufenster */
export interface PreviewUrls {
  download: string;
  /** Bilder und PDF zur Anzeige im Browser */
  inline: string;
  /** Aufbereitete Vorschau (Text, Mail) */
  preview: string;
  /** Anhang einer Mail in der Vorschau herunterladen; ohne: nur die Liste */
  nested?: (index: number) => string;
}

/** Vorschau eines Anhangs (Antwort des Servers) */
export interface AttachmentPreviewData {
  kind: PreviewKind;
  text?: string;
  truncated?: boolean;
  mail?: {
    headers: { from: string; to: string[]; cc: string[]; subject: string; date: string | null };
    text: string;
    html: string | null;
    attachments: { index: number; filename: string; contentType: string; size: number }[];
  };
}

/** Adressen für Anhänge einer gespeicherten Mail («path»: …/attachments/<Index>, «query»: z.B. «?messageId=…») */
export function mailAttachmentUrls(path: string, query = ''): PreviewUrls {
  return {
    download: `${path}${query}`,
    inline: `${path}${query ? `${query}&` : '?'}inline=1`,
    preview: `${path}/preview${query}`,
  };
}
