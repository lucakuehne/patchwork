import { describe, expect, it } from 'vitest';
import { dueState, formatDay, plainPreview, toLocalInput, today } from './format';

describe('Vorschau der Beschreibung', () => {
  it('ohne Formatierung, Links mit Text, Erwähnungen und Bilder lesbar', () => {
    const md =
      '## Ablauf\n\n- **Notebook** bestellen\n- [Formular](https://firma.ch/f) ausfüllen\n\n' +
      'Frage an [@Ivan Informatik](mention:0b6a1c4e-9f2d-4c8e-a1b2-3c4d5e6f7a8b)\n\n![Screenshot.png](attachment:x) `code` \\*kein Stern\\*';
    expect(plainPreview(md)).toBe(
      'Ablauf Notebook bestellen Formular ausfüllen Frage an @Ivan Informatik [Bild: Screenshot.png] code *kein Stern*',
    );
  });

  it('kürzt lange Texte', () => {
    expect(plainPreview('Wort '.repeat(100), 20)).toBe('Wort Wort Wort Wort …');
  });
});

describe('Fälligkeit', () => {
  it('Datum ohne Uhrzeit als TT.MM.JJJJ', () => {
    expect(formatDay('2026-10-24')).toBe('24.10.2026');
  });

  it('heutiges Datum lokal', () => {
    expect(today(new Date(2026, 0, 5, 23, 59))).toBe('2026-01-05');
  });

  it('Zeitpunkt für ein Feld mit Datum und Uhrzeit, lokal und auf die Minute', () => {
    const at = new Date(2026, 9, 7, 8, 5, 42);
    expect(toLocalInput(at)).toBe('2026-10-07T08:05');
    expect(toLocalInput(at.toISOString())).toBe('2026-10-07T08:05');
    // Zurück in einen Zeitpunkt: wieder dieselbe Ortszeit
    expect(new Date(toLocalInput(at)).getHours()).toBe(8);
  });

  it('überfällig, heute, später; abgeschlossen ohne Farbe', () => {
    expect(dueState(null, false, '2026-10-21')).toBeNull();
    expect(dueState('2026-10-20', false, '2026-10-21')).toBe('overdue');
    expect(dueState('2026-10-21', false, '2026-10-21')).toBe('today');
    expect(dueState('2026-10-22', false, '2026-10-21')).toBe('later');
    expect(dueState('2026-10-20', true, '2026-10-21')).toBe('done');
  });
});
