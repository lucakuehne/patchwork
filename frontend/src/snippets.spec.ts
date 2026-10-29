import { describe, expect, it } from 'vitest';
import { fillSnippet, SNIPPET_PLACEHOLDERS } from './snippets';

const anna = { firstName: 'Anna', lastName: 'Muster' };
const ivan = { firstName: 'Ivan', lastName: 'IT' };
const ada = { firstName: 'Ada', lastName: 'Admin' };

describe('fillSnippet', () => {
  it('ersetzt Platzhalter, unbekannte bleiben stehen', () => {
    const text = fillSnippet(
      'Guten Tag {{Melder Vorname}} {{Melder Nachname}}, zu {{ nummer }} «{{Titel}}» ({{Zuständig Vorname}} {{Zuständig Nachname}}). ' +
        '{{Gruss}}, {{Bearbeiter Vorname}} {{Bearbeiter Nachname}}',
      { prefix: 'PW', number: 42, title: 'VPN', reporter: anna, assignee: ivan, editor: ada },
    );
    expect(text).toBe('Guten Tag Anna Muster, zu PW-42 «VPN» (Ivan IT). {{Gruss}}, Ada Admin');
  });

  it('Gross-/Kleinschreibung und Leerzeichen im Platzhalter sind egal', () => {
    expect(fillSnippet('{{melder vorname}} {{ MELDER   NACHNAME }}', { prefix: 'PW', number: 1, title: '', reporter: anna, assignee: null, editor: ada })).toBe(
      'Anna Muster',
    );
  });

  it('lässt Zuständig ohne Zuweisung leer', () => {
    const values = { prefix: 'PW', number: 7, title: 'Drucker', reporter: anna, assignee: null, editor: ada };
    expect(fillSnippet('[{{Zuständig Vorname}}|{{Zuständig Nachname}}]', values)).toBe('[|]');
  });

  it('kennt {{Melder}} und {{Bearbeiter}} nicht mehr', () => {
    const values = { prefix: 'PW', number: 7, title: 'Drucker', reporter: anna, assignee: ivan, editor: ada };
    expect(fillSnippet('{{Melder}} {{Bearbeiter}} {{Zuständig}}', values)).toBe('{{Melder}} {{Bearbeiter}} {{Zuständig}}');
  });

  it('ersetzt jeden angebotenen Platzhalter', () => {
    const values = { prefix: 'PW', number: 7, title: 'Drucker', reporter: anna, assignee: ivan, editor: ada };
    for (const p of SNIPPET_PLACEHOLDERS) expect(fillSnippet(p.token, values), p.token).not.toContain('{{');
  });
});
