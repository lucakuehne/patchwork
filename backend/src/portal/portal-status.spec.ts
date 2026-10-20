import { describe, expect, it } from 'vitest';
import type { TargetsByType } from '../statuses/status-rules';
import { portalStatus, RECEIVED } from './portal-status';

const targets: TargetsByType = {
  incident: { start: 'i-neu', reply: 'i-arbeit', close: 'i-geloest', waiting: 'i-wartet' },
  task: { start: 't-backlog', reply: 't-arbeit', close: 't-erledigt', reject: 't-abgelehnt' },
};

describe('Status im Portal', () => {
  it('zeigt im Eingang «Eingegangen»', () => {
    expect(portalStatus(null, targets)).toEqual({ label: 'Eingegangen', color: 'blue', closed: false, waiting: false });
    // Jeder Aufruf liefert ein eigenes Objekt
    expect(portalStatus(null, targets)).not.toBe(RECEIVED);
  });

  it('zeigt den internen Statusnamen mit Farbe und «abgeschlossen»', () => {
    expect(portalStatus({ id: 'i-arbeit', type: 'incident', label: 'In Arbeit', color: 'orange', closed: false }, targets)).toEqual({
      label: 'In Arbeit',
      color: 'orange',
      closed: false,
      waiting: false,
    });
    expect(portalStatus({ id: 't-abgelehnt', type: 'task', label: 'Abgelehnt', color: 'red', closed: true }, targets)).toEqual({
      label: 'Abgelehnt',
      color: 'red',
      closed: true,
      waiting: false,
    });
  });

  it('hebt nur den Wartet-Status des eigenen Typs hervor', () => {
    const wartet = { id: 'i-wartet', label: 'Wartet auf Melder', color: 'gray', closed: false };
    expect(portalStatus({ ...wartet, type: 'incident' }, targets).waiting).toBe(true);
    // Aufgaben haben hier keinen Wartet-Status
    expect(portalStatus({ ...wartet, type: 'task' }, targets).waiting).toBe(false);
  });

  it('ersetzt unbekannte Farben durch Grau', () => {
    expect(portalStatus({ id: 'x', type: 'task', label: 'Alt', color: 'cat-done', closed: false }, targets).color).toBe('gray');
  });
});
