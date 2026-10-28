import { describe, expect, it } from 'vitest';
import type { TargetsByType } from '../statuses/status-rules';
import { portalStatus, RECEIVED } from './portal-status';

const targets: TargetsByType = {
  incident: { start: 'i-new', reply: 'i-progress', close: 'i-resolved', waiting: 'i-waiting' },
  task: { start: 't-backlog', reply: 't-progress', close: 't-done', reject: 't-rejected' },
};

describe('Status im Portal', () => {
  it('zeigt im Eingang «Eingegangen»', () => {
    expect(portalStatus(null, targets)).toEqual({ label: 'Eingegangen', color: 'blue', closed: false, waiting: false });
    // Jeder Aufruf liefert ein eigenes Objekt
    expect(portalStatus(null, targets)).not.toBe(RECEIVED);
  });

  it('zeigt den internen Statusnamen mit Farbe und «abgeschlossen»', () => {
    expect(portalStatus({ id: 'i-progress', type: 'incident', label: 'In Arbeit', color: 'orange', closed: false }, targets)).toEqual({
      label: 'In Arbeit',
      color: 'orange',
      closed: false,
      waiting: false,
    });
    expect(portalStatus({ id: 't-rejected', type: 'task', label: 'Abgelehnt', color: 'red', closed: true }, targets)).toEqual({
      label: 'Abgelehnt',
      color: 'red',
      closed: true,
      waiting: false,
    });
  });

  it('hebt nur den Wartet-Status des eigenen Typs hervor', () => {
    const waiting = { id: 'i-waiting', label: 'Wartet auf Melder', color: 'gray', closed: false };
    expect(portalStatus({ ...waiting, type: 'incident' }, targets).waiting).toBe(true);
    // Aufgaben haben hier keinen Wartet-Status
    expect(portalStatus({ ...waiting, type: 'task' }, targets).waiting).toBe(false);
  });

  it('ersetzt unbekannte Farben durch Grau', () => {
    expect(portalStatus({ id: 'x', type: 'task', label: 'Alt', color: 'cat-done', closed: false }, targets).color).toBe('gray');
  });
});
