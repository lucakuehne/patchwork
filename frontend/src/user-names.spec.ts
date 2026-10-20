import { describe, expect, it } from 'vitest';
import { followName, splitName } from './user-names';

describe('splitName', () => {
  it.each([
    ['Anna Muster', 'Anna', 'Muster'],
    ['Anna Maria Muster', 'Anna Maria', 'Muster'],
    ['Muster, Anna', 'Anna', 'Muster'],
    ['  Muster ,  Anna Maria ', 'Anna Maria', 'Muster'],
    ['Muster,', '', 'Muster'],
    ['anna.muster', 'Anna', 'Muster'],
    ['hans_peter.meier', 'Hans Peter', 'Meier'],
    ['anna@firma.ch', 'anna@firma.ch', ''],
    ['Helpdesk', 'Helpdesk', ''],
    ['', '', ''],
  ])('%s → %s / %s', (name, firstName, lastName) => {
    expect(splitName(name)).toEqual({ firstName, lastName });
  });
});

describe('followName', () => {
  const auto = { firstName: false, lastName: false };

  it('Beim Eintippen folgen beide Felder dem Namen', () => {
    let names = { firstName: '', lastName: '' };
    for (const name of ['A', 'Anna', 'Anna ', 'Anna M', 'Anna Muster']) names = followName(name, names, auto);
    expect(names).toEqual({ firstName: 'Anna', lastName: 'Muster' });
    expect(followName('Muster, Anna', names, auto)).toEqual({ firstName: 'Anna', lastName: 'Muster' });
    expect(followName('', names, auto)).toEqual({ firstName: '', lastName: '' });
  });

  it('Selbst geänderte Felder bleiben, die übrigen folgen weiter', () => {
    const names = { firstName: 'Anna', lastName: 'Muster' };
    expect(followName('Anna Maria Meier', names, { firstName: true, lastName: false })).toEqual({
      firstName: 'Anna',
      lastName: 'Meier',
    });
    expect(followName('Anna Maria Meier', names, { firstName: false, lastName: true })).toEqual({
      firstName: 'Anna Maria',
      lastName: 'Muster',
    });
    expect(followName('Hans Meier', { firstName: '', lastName: '' }, { firstName: true, lastName: true })).toEqual({
      firstName: '',
      lastName: '',
    });
  });
});
