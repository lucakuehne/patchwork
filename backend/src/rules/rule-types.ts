import { z } from 'zod';
import type { ItemType, Priority } from '../db/schema';

/** Auslöser: neue Vorgänge aus Mails bzw. dem Portal, Antworten auf bestehende Vorgänge */
export const RULE_TRIGGERS = ['mail_new', 'portal_new', 'mail_reply', 'portal_reply'] as const;
export type RuleTrigger = (typeof RULE_TRIGGERS)[number];
export const isNewItemTrigger = (t: RuleTrigger) => t === 'mail_new' || t === 'portal_new';

/** Zeitgesteuerte Regeln: Status-Kategorien, für die eine Wartezeit gezählt wird */
export const SCHEDULE_CATEGORIES = ['new', 'in_progress', 'waiting'] as const;
export type ScheduleCategory = (typeof SCHEDULE_CATEGORIES)[number];

/** Zeitgesteuert: Vorgang ist seit «days» Tagen (seit dem letzten Statuswechsel) in einem Status der Kategorie */
export interface RuleSchedule {
  category: ScheduleCategory;
  days: number;
}

export const CONDITION_FIELDS = ['sender', 'subject', 'body', 'mailbox', 'adGroup'] as const;
export type ConditionField = (typeof CONDITION_FIELDS)[number];

export const CONDITION_OPERATORS = ['is', 'isNot', 'domain', 'notDomain', 'contains', 'notContains', 'member', 'notMember'] as const;
export type ConditionOperator = (typeof CONDITION_OPERATORS)[number];

/** Erlaubte Operatoren je Feld */
export const OPERATORS_BY_FIELD: Record<ConditionField, readonly ConditionOperator[]> = {
  sender: ['is', 'isNot', 'domain', 'notDomain'],
  subject: ['contains', 'notContains'],
  body: ['contains', 'notContains'],
  mailbox: ['is', 'isNot'],
  adGroup: ['member', 'notMember'],
};

export interface RuleCondition {
  kind: 'condition';
  field: ConditionField;
  operator: ConditionOperator;
  /** Adresse, Domain, Suchtext, Postfach-ID bzw. DN der AD-Gruppe */
  value: string;
}

export interface RuleGroup {
  kind: 'group';
  op: 'and' | 'or';
  children: (RuleCondition | RuleGroup)[];
}

export interface RuleActions {
  type?: ItemType;
  priority?: Priority;
  assigneeId?: string;
  checklistTemplateId?: string;
  suppressConfirmation?: boolean;
  discard?: boolean;
  /** Zeitgesteuert, nur «Wartend»: Erinnerung per Mail an den Melder */
  remindReporter?: boolean;
  /** Zeitgesteuert, nur «Wartend»: Vorgang schliessen (erster Status «Erledigt»), mit Mail an den Melder */
  close?: boolean;
}

/** Aktionen, die bei zeitgesteuerten Regeln möglich sind */
export const TIMED_ACTIONS: (keyof RuleActions)[] = ['priority', 'assigneeId', 'remindReporter', 'close'];

const conditionSchema = z
  .object({
    kind: z.literal('condition'),
    field: z.enum(CONDITION_FIELDS),
    operator: z.enum(CONDITION_OPERATORS),
    value: z.string().trim().min(1, 'Bitte bei jeder Bedingung einen Wert angeben').max(500),
  })
  .refine((c) => OPERATORS_BY_FIELD[c.field].includes(c.operator), 'Ungültige Bedingung');

// Eine Ebene Untergruppen genügt für Ausdrücke wie (A und B) oder C
const subGroupSchema = z.object({
  kind: z.literal('group'),
  op: z.enum(['and', 'or']),
  children: z.array(conditionSchema).min(1, 'Eine Gruppe braucht mindestens eine Bedingung').max(30),
});

export const conditionsSchema = z.object({
  kind: z.literal('group'),
  op: z.enum(['and', 'or']),
  children: z.array(z.union([conditionSchema, subGroupSchema])).max(30),
});

export const actionsSchema = z
  .object({
    type: z.enum(['incident', 'task']).optional(),
    priority: z.enum(['high', 'normal', 'low']).optional(),
    assigneeId: z.uuid().optional(),
    checklistTemplateId: z.uuid().optional(),
    suppressConfirmation: z.boolean().optional(),
    discard: z.boolean().optional(),
    remindReporter: z.boolean().optional(),
    close: z.boolean().optional(),
  })
  .refine((a) => Object.values(a).some(Boolean), 'Bitte mindestens eine Aktion wählen');

export const scheduleSchema = z.object({
  category: z.enum(SCHEDULE_CATEGORIES),
  days: z.number().int().min(1, 'Mindestens 1 Tag').max(365, 'Höchstens 365 Tage'),
});

const triggersSchema = z
  .array(z.enum(RULE_TRIGGERS))
  .default([])
  .transform((list) => [...new Set(list)]);

/** Eine Regel greift entweder bei Ereignissen oder nach Zeit, nicht beides. */
function checkKind(r: { triggers: RuleTrigger[]; schedule: RuleSchedule | null }, ctx: z.RefinementCtx) {
  if ((r.triggers.length > 0) === (r.schedule !== null)) {
    ctx.addIssue({ code: 'custom', message: 'Bitte entweder Ereignisse oder eine Zeit als Auslöser wählen' });
  }
}

export const ruleSchema = z
  .object({
    name: z.string().trim().min(1, 'Name fehlt').max(200),
    active: z.boolean().default(true),
    triggers: triggersSchema,
    schedule: scheduleSchema.nullable().default(null),
    conditions: conditionsSchema,
    actions: actionsSchema,
  })
  .superRefine((r, ctx) => {
    checkKind(r, ctx);
    const used = (Object.keys(r.actions) as (keyof RuleActions)[]).filter((k) => r.actions[k]);
    if (r.schedule) {
      if (used.some((k) => !TIMED_ACTIONS.includes(k))) {
        ctx.addIssue({ code: 'custom', message: 'Zeitgesteuerte Regeln setzen nur Priorität, Zuständig, Erinnerung oder Schliessen' });
      }
      if ((r.actions.remindReporter || r.actions.close) && r.schedule.category !== 'waiting') {
        ctx.addIssue({ code: 'custom', message: 'Erinnern und Schliessen gibt es nur für die Kategorie «Wartend»' });
      }
    } else if (r.actions.remindReporter || r.actions.close) {
      ctx.addIssue({ code: 'custom', message: 'Erinnern und Schliessen gibt es nur bei zeitgesteuerten Regeln' });
    }
  });
export type RuleInputDto = z.infer<typeof ruleSchema>;

export const previewSchema = z
  .object({
    triggers: triggersSchema,
    schedule: scheduleSchema.nullable().default(null),
    conditions: conditionsSchema,
  })
  .superRefine(checkKind);
