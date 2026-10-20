import { describe, expect, it } from 'vitest';
import { splitName } from './user-names';

describe('splitName', () => {
  it.each([
    ['Anna Muster', 'Anna', 'Muster'],
    ['Anna Maria Muster', 'Anna Maria', 'Muster'],
    ['Muster, Anna', 'Anna', 'Muster'],
    ['  Muster ,  Anna Maria ', 'Anna Maria', 'Muster'],
    ['anna.muster', 'Anna', 'Muster'],
    ['hans_peter.meier', 'Hans Peter', 'Meier'],
    ['Helpdesk', 'Helpdesk', ''],
    // Trenner aussen zählen nicht, Leerraum wie Tabulatoren wird zu einem Leerzeichen (wie Migration 0024)
    ['a.b_', 'A', 'B'],
    ['J.P.', 'J', 'P'],
    ['.anna.muster', 'Anna', 'Muster'],
    ['anna-maria.muster', 'Anna-Maria', 'Muster'],
    ['Anna\tMuster\n', 'Anna', 'Muster'],
    ['...', '...', ''],
    ['', '', ''],
  ])('%s → %s / %s', (name, firstName, lastName) => {
    expect(splitName(name)).toEqual({ firstName, lastName });
  });
});
