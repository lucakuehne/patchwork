import type { RuleCondition, RuleGroup, RuleTrigger } from './rule-types';

/** Angaben zu einer eingehenden Mail, Portal-Meldung oder Antwort, gegen die Regeln geprüft werden. */
export interface RuleEvent {
  /** «timed»: zeitgesteuerte Regel, die Angaben stammen dann aus dem Vorgang */
  trigger: RuleTrigger | 'timed';
  /** E-Mail-Adresse des Absenders bzw. Melders */
  sender: string;
  /** Betreff der Mail bzw. Titel des Vorgangs */
  subject: string;
  /** Text der Mail, Beschreibung bzw. Antwort */
  body: string;
  /** Postfach, in dem die Mail eingegangen ist (null im Portal) */
  mailboxId: string | null;
}

/**
 * Prüft die Mitgliedschaft in einer AD-Gruppe. null = unbekannt (Verzeichnis nicht erreichbar,
 * LDAP ausgeschaltet); dann trifft weder «ist in Gruppe» noch «ist nicht in Gruppe» zu.
 */
export type GroupCheck = (email: string, groupDn: string) => Promise<boolean | null>;

/** Trifft die Bedingungsgruppe zu? Eine leere Gruppe trifft immer zu. */
export async function matchesGroup(group: RuleGroup, event: RuleEvent, inGroup: GroupCheck): Promise<boolean> {
  if (group.children.length === 0) return true;
  for (const child of group.children) {
    const hit = child.kind === 'group' ? await matchesGroup(child, event, inGroup) : await matchesCondition(child, event, inGroup);
    // UND: erste Abweichung entscheidet, ODER: erster Treffer entscheidet
    if (group.op === 'and' && !hit) return false;
    if (group.op === 'or' && hit) return true;
  }
  return group.op === 'and';
}

export async function matchesCondition(c: RuleCondition, event: RuleEvent, inGroup: GroupCheck): Promise<boolean> {
  const value = c.value.trim().toLowerCase();
  switch (c.field) {
    case 'sender': {
      const sender = event.sender.trim().toLowerCase();
      const domain = sender.slice(sender.lastIndexOf('@') + 1);
      const wanted = value.replace(/^@/, '');
      if (c.operator === 'is') return sender === value;
      if (c.operator === 'isNot') return sender !== value;
      if (c.operator === 'domain') return domain === wanted;
      if (c.operator === 'notDomain') return domain !== wanted;
      return false;
    }
    case 'subject':
    case 'body': {
      const text = (c.field === 'subject' ? event.subject : event.body).toLowerCase();
      if (c.operator === 'contains') return text.includes(value);
      if (c.operator === 'notContains') return !text.includes(value);
      return false;
    }
    case 'mailbox':
      if (c.operator === 'is') return event.mailboxId === c.value.trim();
      if (c.operator === 'isNot') return event.mailboxId !== c.value.trim();
      return false;
    case 'adGroup': {
      const member = await inGroup(event.sender.trim().toLowerCase(), c.value.trim());
      if (member === null) return false;
      return c.operator === 'member' ? member : c.operator === 'notMember' ? !member : false;
    }
  }
}
