import { itemRef } from './format';
import type { IncomingMail, IncomingResult } from './types';

/** Ergebnisse der Verarbeitung eingehender Mails, mit Farbe des Hinweises */
export const INCOMING_RESULTS: Record<IncomingResult, { label: string; kind: string }> = {
  created: { label: 'neuer Vorgang', kind: 'created' },
  reply: { label: 'Antwort', kind: 'reply' },
  note: { label: 'interne Notiz', kind: 'note' },
  automated: { label: 'automatische Antwort', kind: 'muted' },
  ignored: { label: 'ignoriert', kind: 'muted' },
  failed: { label: 'Fehler', kind: 'failed' },
};

/** Ergebnis in einem Satz, z.B. «Antwort in PW-12» oder «ignoriert (eigene Adresse)». */
export function incomingResultText(mail: Pick<IncomingMail, 'result' | 'reason' | 'item'>): string {
  const label = INCOMING_RESULTS[mail.result].label;
  if (mail.result === 'ignored' || mail.result === 'failed') return mail.reason ? `${label} (${mail.reason})` : label;
  if (!mail.item) return label;
  return mail.result === 'created' ? `${label} ${itemRef(mail.item.number)}` : `${label} in ${itemRef(mail.item.number)}`;
}
