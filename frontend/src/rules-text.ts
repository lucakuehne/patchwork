import { CATEGORY_LABELS, PRIORITY_LABELS, TYPE_LABELS } from './format';
import type {
  ConditionField,
  ConditionOperator,
  Rule,
  RuleActions,
  RuleCondition,
  RuleGroup,
  RuleTrigger,
  ScheduleCategory,
} from './types';

export const TRIGGER_LABELS: Record<RuleTrigger, string> = {
  mail_new: 'Neue Mail',
  portal_new: 'Neue Meldung im Portal',
  mail_reply: 'Antwort per Mail',
  portal_reply: 'Antwort im Portal',
};
export const TRIGGERS = Object.keys(TRIGGER_LABELS) as RuleTrigger[];
export const isReplyTrigger = (t: RuleTrigger) => t === 'mail_reply' || t === 'portal_reply';

export const SCHEDULE_CATEGORIES: ScheduleCategory[] = ['new', 'in_progress', 'waiting'];

/** Auslöser einer Regel als Text, z.B. «Neue Mail, Antwort per Mail» oder «seit 7 Tagen Wartend» */
export function describeTrigger(rule: Pick<Rule, 'triggers' | 'schedule'>): string {
  if (rule.schedule) {
    const days = rule.schedule.days === 1 ? '1 Tag' : `${rule.schedule.days} Tagen`;
    return `seit ${days} in «${CATEGORY_LABELS[rule.schedule.category]}»`;
  }
  return rule.triggers.map((t) => TRIGGER_LABELS[t]).join(', ');
}

export const FIELD_LABELS: Record<ConditionField, string> = {
  sender: 'Absender',
  subject: 'Betreff',
  body: 'Text',
  mailbox: 'Postfach',
  adGroup: 'AD-Gruppe des Absenders',
};

/** Operatoren je Feld mit kurzer Bezeichnung für die Auswahl */
export const OPERATORS: Record<ConditionField, { value: ConditionOperator; label: string }[]> = {
  sender: [
    { value: 'is', label: 'ist' },
    { value: 'isNot', label: 'ist nicht' },
    { value: 'domain', label: 'Domain ist' },
    { value: 'notDomain', label: 'Domain ist nicht' },
  ],
  subject: [
    { value: 'contains', label: 'enthält' },
    { value: 'notContains', label: 'enthält nicht' },
  ],
  body: [
    { value: 'contains', label: 'enthält' },
    { value: 'notContains', label: 'enthält nicht' },
  ],
  mailbox: [
    { value: 'is', label: 'ist' },
    { value: 'isNot', label: 'ist nicht' },
  ],
  adGroup: [
    { value: 'member', label: 'enthält den Absender' },
    { value: 'notMember', label: 'enthält den Absender nicht' },
  ],
};

export const VALUE_PLACEHOLDERS: Partial<Record<ConditionOperator, string>> = {
  is: 'name@firma.ch',
  isNot: 'name@firma.ch',
  domain: '@lieferant.ch',
  notDomain: '@firma.ch',
  contains: 'Suchtext',
  notContains: 'Suchtext',
  member: 'CN=Geschäftsleitung,OU=Gruppen,DC=firma,DC=local',
  notMember: 'CN=Mitarbeitende,OU=Gruppen,DC=firma,DC=local',
};

/** Erster Teil eines DN, z.B. «Geschäftsleitung» aus «CN=Geschäftsleitung,OU=…» */
export function groupName(dn: string): string {
  const first = dn.split(',')[0] ?? dn;
  return first.includes('=') ? first.slice(first.indexOf('=') + 1).trim() : dn;
}

export interface RuleLookups {
  mailbox: (id: string) => string | undefined;
  user: (id: string) => string | undefined;
  template: (id: string) => string | undefined;
}

function describeCondition(c: RuleCondition, lookups: RuleLookups): string {
  const op = OPERATORS[c.field].find((o) => o.value === c.operator)?.label ?? c.operator;
  if (c.field === 'mailbox') return `Postfach ${op} «${lookups.mailbox(c.value) ?? 'gelöscht'}»`;
  if (c.field === 'adGroup') return `AD-Gruppe «${groupName(c.value)}» ${op}`;
  if (c.field === 'sender' && (c.operator === 'domain' || c.operator === 'notDomain')) {
    return `Absender-${op} ${c.value}`;
  }
  if (c.field === 'sender') return `Absender ${op} ${c.value}`;
  return `${FIELD_LABELS[c.field]} ${op} «${c.value}»`;
}

/** Bedingungen als Text, Untergruppen in Klammern */
export function describeConditions(group: RuleGroup, lookups: RuleLookups, nested = false): string {
  if (group.children.length === 0) return 'immer';
  const joiner = group.op === 'and' ? ' und ' : ' oder ';
  const text = group.children
    .map((c) => (c.kind === 'group' ? describeConditions(c, lookups, true) : describeCondition(c, lookups)))
    .join(joiner);
  return nested && group.children.length > 1 ? `(${text})` : text;
}

export function describeActions(a: RuleActions, lookups: RuleLookups): string {
  const parts: string[] = [];
  if (a.discard) parts.push('verwerfen');
  if (a.type) parts.push(`Typ ${TYPE_LABELS[a.type]}`);
  if (a.priority) parts.push(`Priorität ${PRIORITY_LABELS[a.priority]}`);
  if (a.assigneeId) parts.push(`zuständig ${lookups.user(a.assigneeId) ?? '(unbekannt)'}`);
  if (a.checklistTemplateId) parts.push(`Checkliste «${lookups.template(a.checklistTemplateId) ?? 'gelöscht'}»`);
  if (a.suppressConfirmation) parts.push('ohne Eingangsbestätigung');
  if (a.remindReporter) parts.push('Melder erinnern');
  if (a.close) parts.push('schliessen');
  return parts.join(', ');
}
