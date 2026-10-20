import type { OutgoingStatus } from './types';

/** Status einer ausgehenden Mail: Bezeichnung und Farbe der Marke (Klasse «sent», «held», «failed» oder «queued») */
export const OUTGOING_STATUS: Record<OutgoingStatus, { label: string; kind: string }> = {
  queued: { label: 'wird versendet', kind: 'queued' },
  sent: { label: 'versendet', kind: 'sent' },
  partial: { label: 'teilweise versendet', kind: 'held' },
  held: { label: 'nicht versendet', kind: 'held' },
  failed: { label: 'Fehler', kind: 'failed' },
};

export interface DeliveryMark {
  text: string;
  /** Erklärung beim Darüberfahren */
  title: string;
  kind: string;
}

/**
 * Vermerk zum Versand im Verlauf (öffentliche Antworten und automatische Mails), nur bei Abweichungen: versendet = kein
 * Vermerk. «withheld»: Empfänger, an die die Mail im Testbetrieb nicht ging.
 */
export function deliveryMark(d: { status: OutgoingStatus; deliveredTo: string[]; withheld: string[]; error: string | null }): DeliveryMark | null {
  switch (d.status) {
    case 'sent':
      return null;
    case 'partial':
      return {
        text: 'teilweise versendet',
        title: `Im Testbetrieb nur an ${d.deliveredTo.join(', ')} versendet, nicht an ${d.withheld.join(', ')}`,
        kind: 'held',
      };
    case 'held':
      return { text: 'nicht versendet', title: `Im Testbetrieb zusammengestellt, aber nicht versendet (an ${d.withheld.join(', ')})`, kind: 'held' };
    case 'failed':
      return { text: 'Versand fehlgeschlagen', title: d.error ?? '', kind: 'failed' };
    case 'queued':
      return { text: 'wird versendet', title: 'Die Mail ist in der Versand-Queue', kind: 'queued' };
  }
}
