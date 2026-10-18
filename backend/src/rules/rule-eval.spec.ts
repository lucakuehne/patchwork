import { describe, expect, it } from 'vitest';
import { matchesCondition, matchesGroup, type GroupCheck, type RuleEvent } from './rule-eval';
import type { RuleCondition, RuleGroup } from './rule-types';

const event: RuleEvent = {
  trigger: 'mail_new',
  sender: 'Anna.Muster@Lieferant.ch',
  subject: 'Bestellung Toner',
  body: 'Bitte DRINGEND liefern.',
  mailboxId: 'mb-1',
};
const noGroups: GroupCheck = async () => false;
const cond = (field: RuleCondition['field'], operator: RuleCondition['operator'], value: string): RuleCondition => ({
  kind: 'condition',
  field,
  operator,
  value,
});
const check = (c: RuleCondition, inGroup: GroupCheck = noGroups) => matchesCondition(c, event, inGroup);

describe('matchesCondition', () => {
  it('Absender: Adresse und Domain, ohne Rücksicht auf Gross-/Kleinschreibung', async () => {
    expect(await check(cond('sender', 'is', 'anna.muster@lieferant.ch'))).toBe(true);
    expect(await check(cond('sender', 'isNot', 'anna.muster@lieferant.ch'))).toBe(false);
    expect(await check(cond('sender', 'domain', '@LIEFERANT.ch'))).toBe(true);
    expect(await check(cond('sender', 'domain', 'lieferant.ch'))).toBe(true);
    expect(await check(cond('sender', 'domain', 'ant.ch'))).toBe(false);
    expect(await check(cond('sender', 'notDomain', 'firma.ch'))).toBe(true);
  });

  it('Betreff und Text enthalten (nicht)', async () => {
    expect(await check(cond('subject', 'contains', 'toner'))).toBe(true);
    expect(await check(cond('subject', 'notContains', 'toner'))).toBe(false);
    expect(await check(cond('body', 'contains', 'dringend'))).toBe(true);
    expect(await check(cond('body', 'notContains', 'newsletter'))).toBe(true);
  });

  it('Postfach', async () => {
    expect(await check(cond('mailbox', 'is', 'mb-1'))).toBe(true);
    expect(await check(cond('mailbox', 'isNot', 'mb-1'))).toBe(false);
    expect(await matchesCondition(cond('mailbox', 'is', 'mb-1'), { ...event, mailboxId: null }, noGroups)).toBe(false);
  });

  it('AD-Gruppe: unbekannt erfüllt weder «ist in» noch «ist nicht in»', async () => {
    const member: GroupCheck = async (email, dn) => email === 'anna.muster@lieferant.ch' && dn === 'CN=GL,DC=firma';
    expect(await check(cond('adGroup', 'member', 'CN=GL,DC=firma'), member)).toBe(true);
    expect(await check(cond('adGroup', 'notMember', 'CN=GL,DC=firma'), member)).toBe(false);
    expect(await check(cond('adGroup', 'notMember', 'CN=IT,DC=firma'), member)).toBe(true);
    const unknown: GroupCheck = async () => null;
    expect(await check(cond('adGroup', 'member', 'CN=GL,DC=firma'), unknown)).toBe(false);
    expect(await check(cond('adGroup', 'notMember', 'CN=GL,DC=firma'), unknown)).toBe(false);
  });
});

describe('matchesGroup', () => {
  const a = cond('sender', 'domain', 'lieferant.ch'); // trifft zu
  const b = cond('subject', 'contains', 'rechnung'); // trifft nicht zu
  const c = cond('body', 'contains', 'dringend'); // trifft zu

  it('UND und ODER', async () => {
    expect(await matchesGroup({ kind: 'group', op: 'and', children: [a, c] }, event, noGroups)).toBe(true);
    expect(await matchesGroup({ kind: 'group', op: 'and', children: [a, b] }, event, noGroups)).toBe(false);
    expect(await matchesGroup({ kind: 'group', op: 'or', children: [b, c] }, event, noGroups)).toBe(true);
    expect(await matchesGroup({ kind: 'group', op: 'or', children: [b] }, event, noGroups)).toBe(false);
  });

  it('Untergruppen: (A und B) oder C', async () => {
    const tree: RuleGroup = { kind: 'group', op: 'or', children: [{ kind: 'group', op: 'and', children: [a, b] }, c] };
    expect(await matchesGroup(tree, event, noGroups)).toBe(true);
    const withoutC: RuleGroup = { kind: 'group', op: 'or', children: [{ kind: 'group', op: 'and', children: [a, b] }] };
    expect(await matchesGroup(withoutC, event, noGroups)).toBe(false);
  });

  it('ohne Bedingungen trifft die Regel immer zu', async () => {
    expect(await matchesGroup({ kind: 'group', op: 'and', children: [] }, event, noGroups)).toBe(true);
  });
});
