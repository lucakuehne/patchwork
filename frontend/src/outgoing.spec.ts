import { describe, expect, it } from 'vitest';
import { deliveryMark } from './outgoing';

describe('deliveryMark', () => {
  const base = { deliveredTo: [] as string[], withheld: [] as string[], error: null };

  it('kein Vermerk, wenn die Mail versendet ist', () => {
    expect(deliveryMark({ ...base, status: 'sent' })).toBeNull();
  });

  it('Testbetrieb: zurückgehalten oder nur an einen Teil der Empfänger, mit Erklärung', () => {
    expect(deliveryMark({ ...base, status: 'held', withheld: ['anna@firma.ch'] })).toEqual({
      text: 'nicht versendet',
      title: 'Im Testbetrieb zusammengestellt, aber nicht versendet (an anna@firma.ch)',
      kind: 'held',
    });
    expect(deliveryMark({ ...base, status: 'partial', deliveredTo: ['carla@firma.ch'], withheld: ['anna@firma.ch'] })?.title).toBe(
      'Im Testbetrieb nur an carla@firma.ch versendet, nicht an anna@firma.ch',
    );
  });

  it('Fehler mit Meldung, unterwegs mit Hinweis auf die Queue', () => {
    expect(deliveryMark({ ...base, status: 'failed', error: 'SMTP 550' })).toEqual({ text: 'Versand fehlgeschlagen', title: 'SMTP 550', kind: 'failed' });
    expect(deliveryMark({ ...base, status: 'queued' })?.text).toBe('wird versendet');
  });
});
