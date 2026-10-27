import { Injectable } from '@nestjs/common';
import { sql, type SQL } from 'drizzle-orm';
import { InjectDb, type Db } from '../db/db.module';
import type { ItemType, Priority } from '../db/schema';
import { PRIORITY_LABELS, TYPE_LABELS } from '../items/items.service';

export type Bucket = 'day' | 'week' | 'month';
/** Ansicht der Auswertungen: nur Störungen, nur Aufgaben oder alle Vorgänge (mit Eingang) */
export type ReportScope = ItemType | 'all';

export interface ReportPeriod {
  from: Date;
  to: Date;
  /** IANA-Zeitzone der Oberfläche, für die Einteilung nach Tagen, Wochen und Monaten */
  timeZone: string;
  bucket: Bucket;
  scope: ReportScope;
}

/** Typische Dauer: Anzahl, Median und Durchschnitt in Stunden */
export interface DurationStats {
  count: number;
  medianHours: number | null;
  averageHours: number | null;
}

export interface Report {
  /** Name des Start-Status der Aufgaben (Standard «Backlog»), für die Beschriftung */
  backlogLabel: string | null;
  totals: {
    created: number;
    /** Im Zeitraum abgeschlossen, davon «rejected» im Ablehnen-Status */
    closed: number;
    rejected: number;
    /** Jetzt offen; bei Aufgaben ohne die im Start-Status (Backlog), die zählen unter «backlog» */
    openNow: number;
    backlog: number;
    /** Störungen, die im Zeitraum aus einem abgeschlossenen Status wieder aufgingen */
    reopened: number;
    /** Im Zeitraum eingegangen und verworfen */
    discarded: number;
  };
  /** Neue und abgeschlossene Vorgänge pro Tag, Woche oder Monat (Beginn als YYYY-MM-DD); «closed» ohne «rejected» */
  flow: {
    start: string;
    created: Record<ItemType | 'inbox', number>;
    closed: Record<ItemType, number>;
    rejected: Record<ItemType, number>;
  }[];
  open: {
    inbox: number;
    byStatus: { type: ItemType; label: string; closed: boolean; count: number }[];
    /** type null = Eingang */
    byPriority: { priority: Priority; type: ItemType | null; count: number }[];
    byAssignee: { id: string | null; name: string | null; type: ItemType | null; count: number }[];
  };
  oldest: { total: number; items: { number: number; title: string; type: ItemType | null; status: string | null; assignee: string | null; createdAt: Date }[] };
  /** Offene Aufgaben mit Fälligkeit vor heute */
  overdue: { total: number; items: { number: number; title: string; status: string; assignee: string | null; dueDate: string }[] };
  /** Dauer bis «Gelöst» bei Störungen, die im Zeitraum abgeschlossen wurden (ohne den Ablehnen-Status) */
  resolution: DurationStats & { byPriority: (DurationStats & { priority: Priority })[] };
  /** Störungen: Zeit bis zur ersten öffentlichen Antwort aus Patchwork (erste Antwort im Zeitraum) */
  firstReply: DurationStats;
  /** Aufgaben: vom Verlassen des Start-Status (Backlog) bis zum Abschluss im Zeitraum (ohne Ablehnen-Status) */
  cycleTime: DurationStats;
  /** Eingang: Zeit bis zur Zuordnung zu Störung oder Aufgabe (Zuordnung im Zeitraum, ohne Regeln) */
  triage: DurationStats;
  topReporters: { name: string; email: string; count: number }[];
  /** Neue Vorgänge im Zeitraum nach Meldeweg; label null = ohne Angabe, type null = Eingang */
  byChannel: { label: string | null; icon: string | null; type: ItemType | null; count: number }[];
}

/** Offen = im Eingang (ohne Status) oder in einem Status, der nicht abgeschlossen ist */
const OPEN = sql`i.discarded = false and (i.status_id is null or not s.closed)`;

/** Status ist der Ablehnen-Status seines Typs («Ablehnen führt in») */
const REJECT_STATUS = sql`exists (select 1 from status_targets t where t.status_id = s.id and t.target = 'reject')`;

/** Status ist der Start-Status der Aufgaben («Neue Aufgabe erhält», Standard Backlog) */
const TASK_START = sql`exists (select 1 from status_targets t where t.status_id = s.id and t.type = 'task' and t.target = 'start')`;

/**
 * Status eines Eintrags «status» (Felder from/to): über die ID, ältere Einträge (vor dem 27.10.2026 nur mit Namen) über
 * den Namen im Typ des Vorgangs. Braucht die Aliase «e» (Eintrag) und «i» (Vorgang).
 */
const entryStatus = (key: 'from' | 'to') =>
  sql`coalesce((e.meta->>${`${key}Id`})::uuid, (select x.id from statuses x where x.type = i.type and x.label = e.meta->>${key} limit 1))`;

/** Anzahl, Median und Durchschnitt einer Dauer in Sekunden, in Stunden */
const stats = (seconds: SQL) =>
  sql`count(*)::int as count, percentile_cont(0.5) within group (order by ${seconds}) / 3600 as median, avg(${seconds}) / 3600 as average`;

interface StatsRow {
  count: number;
  median: number | string | null;
  average: number | string | null;
}
const hours = (v: number | string | null | undefined) => (v === null || v === undefined ? null : Number(v));
const toStats = (row: StatsRow | undefined): DurationStats => ({
  count: row?.count ?? 0,
  medianHours: hours(row?.median),
  averageHours: hours(row?.average),
});

/** Auswertungen (nur Admin). Die Kennzahlen für «offen» gelten für jetzt, alle anderen für den Zeitraum. */
@Injectable()
export class ReportsService {
  constructor(@InjectDb() private readonly db: Db) {}

  private async rows<T>(query: SQL): Promise<T[]> {
    const result = await this.db.execute(query);
    return result.rows as T[];
  }

  async report(p: ReportPeriod): Promise<Report> {
    const from = p.from.toISOString();
    const to = p.to.toISOString();
    const inPeriod = (column: SQL) => sql`${column} >= ${from}::timestamptz and ${column} < ${to}::timestamptz`;
    const bucketOf = (column: SQL) => sql`to_char(date_trunc(${p.bucket}, ${column} at time zone ${p.timeZone}), 'YYYY-MM-DD')`;
    // Ansicht: bei «Alle» auch der Eingang (ohne Typ)
    const inScope = p.scope === 'all' ? sql`true` : sql`i.type::text = ${p.scope}`;
    // Aufgaben: Zuständige und älteste offene ohne das Backlog
    const active = p.scope === 'task' ? sql`not ${TASK_START}` : sql`true`;

    const [backlogStatus, starts, created, closed] = await Promise.all([
      this.rows<{ label: string }>(sql`
        select s.label from status_targets t join statuses s on s.id = t.status_id where t.type = 'task' and t.target = 'start'`),
      this.rows<{ start: string }>(sql`
        select to_char(s, 'YYYY-MM-DD') as start from generate_series(
          date_trunc(${p.bucket}, ${from}::timestamptz at time zone ${p.timeZone}),
          date_trunc(${p.bucket}, (${to}::timestamptz - interval '1 second') at time zone ${p.timeZone}),
          ('1 ' || ${p.bucket})::interval
        ) as s`),
      this.rows<{ start: string; type: string; n: number }>(sql`
        select ${bucketOf(sql`i.created_at`)} as start, coalesce(i.type::text, 'inbox') as type, count(*)::int as n
        from items i
        where i.discarded = false and ${inPeriod(sql`i.created_at`)} and ${inScope}
        group by 1, 2`),
      this.rows<{ start: string; type: ItemType; rejected: boolean; n: number }>(sql`
        select ${bucketOf(sql`i.closed_at`)} as start, i.type::text as type, ${REJECT_STATUS} as rejected, count(*)::int as n
        from items i join statuses s on s.id = i.status_id
        where i.discarded = false and i.type is not null and ${inPeriod(sql`i.closed_at`)} and ${inScope}
        group by 1, 2, 3`),
    ]);
    const flow = starts.map(({ start }) => ({
      start,
      created: { incident: 0, task: 0, inbox: 0 } as Record<ItemType | 'inbox', number>,
      closed: { incident: 0, task: 0 } as Record<ItemType, number>,
      rejected: { incident: 0, task: 0 } as Record<ItemType, number>,
    }));
    const byStart = new Map(flow.map((f) => [f.start, f]));
    for (const r of created) {
      const f = byStart.get(r.start);
      if (f) f.created[r.type as ItemType | 'inbox'] += r.n;
    }
    for (const r of closed) {
      const f = byStart.get(r.start);
      if (f) (r.rejected ? f.rejected : f.closed)[r.type] += r.n;
    }

    const [openCount, byStatus, inbox, byPriority, byAssignee, oldest, oldestTotal, overdue, overdueTotal] = await Promise.all([
      this.rows<{ total: number; backlog: number }>(sql`
        select count(*)::int as total, count(*) filter (where ${TASK_START})::int as backlog
        from items i left join statuses s on s.id = i.status_id
        where ${OPEN} and ${inScope}`),
      this.rows<{ type: ItemType; label: string; closed: boolean; count: number }>(sql`
        select s.type::text as type, s.label, s.closed, count(i.id)::int as count
        from items i join statuses s on s.id = i.status_id
        where ${OPEN} and ${inScope}
        group by s.id, s.type, s.label, s.closed, s.position
        order by s.type, s.position`),
      this.rows<{ n: number }>(sql`select count(*)::int as n from items i where i.discarded = false and i.type is null`),
      this.rows<{ priority: Priority; type: ItemType | null; count: number }>(sql`
        select i.priority::text as priority, i.type::text as type, count(*)::int as count
        from items i left join statuses s on s.id = i.status_id
        where ${OPEN} and ${inScope}
        group by 1, 2`),
      this.rows<{ id: string | null; name: string | null; type: ItemType | null; count: number }>(sql`
        select u.id, u.name, i.type::text as type, count(*)::int as count
        from items i left join statuses s on s.id = i.status_id left join users u on u.id = i.assignee_id
        where ${OPEN} and ${inScope} and ${active}
        group by u.id, u.name, i.type`),
      this.rows<{ number: number; title: string; type: ItemType | null; status: string | null; assignee: string | null; createdAt: Date }>(sql`
        select i.number, i.title, i.type::text as type, s.label as status, u.name as assignee, i.created_at as "createdAt"
        from items i left join statuses s on s.id = i.status_id left join users u on u.id = i.assignee_id
        where ${OPEN} and ${inScope} and ${active} and i.created_at < now() - interval '30 days'
        order by i.created_at asc
        limit 20`),
      this.rows<{ n: number }>(sql`
        select count(*)::int as n
        from items i left join statuses s on s.id = i.status_id
        where ${OPEN} and ${inScope} and ${active} and i.created_at < now() - interval '30 days'`),
      this.rows<{ number: number; title: string; status: string; assignee: string | null; dueDate: string }>(sql`
        select i.number, i.title, s.label as status, u.name as assignee, i.due_date::text as "dueDate"
        from items i join statuses s on s.id = i.status_id left join users u on u.id = i.assignee_id
        where ${OPEN} and i.type = 'task' and i.due_date < (now() at time zone ${p.timeZone})::date
        order by i.due_date, i.number
        limit 20`),
      this.rows<{ n: number }>(sql`
        select count(*)::int as n
        from items i join statuses s on s.id = i.status_id
        where ${OPEN} and i.type = 'task' and i.due_date < (now() at time zone ${p.timeZone})::date`),
    ]);

    const [resolution, firstReply, reopened, cycleTime, triage, discarded, topReporters, byChannel] = await Promise.all([
      // Gesamt (priority null) und je Priorität
      this.rows<StatsRow & { priority: Priority | null }>(sql`
        select i.priority::text as priority, ${stats(sql`extract(epoch from i.closed_at - i.created_at)`)}
        from items i join statuses s on s.id = i.status_id
        where i.discarded = false and i.type = 'incident' and s.closed and not ${REJECT_STATUS} and ${inPeriod(sql`i.closed_at`)}
        group by grouping sets ((), (i.priority))`),
      // Erste öffentliche Antwort aus Patchwork: ohne Antworten per Mail oder Portal und ohne den Melder selbst
      this.rows<StatsRow>(sql`
        with first as (
          select i.created_at, min(e.created_at) as replied_at
          from items i join entries e on e.item_id = i.id
          where i.discarded = false and i.type = 'incident' and e.kind = 'reply' and e.author_id is not null
            and e.author_id is distinct from i.reporter_id and e.meta->>'source' is null
          group by i.id, i.created_at
        )
        select ${stats(sql`greatest(0, extract(epoch from replied_at - created_at))`)}
        from first where ${inPeriod(sql`replied_at`)}`),
      this.rows<{ n: number }>(sql`
        select count(distinct i.id)::int as n
        from entries e
        join items i on i.id = e.item_id
        join statuses f on f.id = ${entryStatus('from')}
        join statuses t on t.id = ${entryStatus('to')}
        where e.kind = 'status' and i.discarded = false and i.type = 'incident' and f.closed and not t.closed
          and ${inPeriod(sql`e.created_at`)}`),
      // Beginn: erster Wechsel aus dem Start-Status; nie im Backlog: Zuordnung zur Aufgabe oder Erfassung
      this.rows<StatsRow>(sql`
        with done as (
          select i.closed_at, coalesce(
            (select min(e.created_at) from entries e
              where e.item_id = i.id and e.kind = 'status'
                and ${entryStatus('from')} = (select st.status_id from status_targets st where st.type = 'task' and st.target = 'start')),
            (select min(e.created_at) from entries e where e.item_id = i.id and e.kind = 'type' and e.meta->>'to' = ${TYPE_LABELS.task}),
            i.created_at
          ) as started_at
          from items i join statuses s on s.id = i.status_id
          where i.discarded = false and i.type = 'task' and s.closed and not ${REJECT_STATUS} and ${inPeriod(sql`i.closed_at`)}
        )
        select ${stats(sql`greatest(0, extract(epoch from closed_at - started_at))`)} from done`),
      // Zuordnung aus dem Eingang (Typwechsel ohne bisherigen Typ) durch eine Person, nicht durch Regeln
      this.rows<StatsRow>(sql`
        with typed as (
          select i.created_at, min(e.created_at) as typed_at
          from items i join entries e on e.item_id = i.id
          where i.discarded = false and e.kind = 'type' and e.meta->>'from' is null and e.author_id is not null
          group by i.id, i.created_at
        )
        select ${stats(sql`greatest(0, extract(epoch from typed_at - created_at))`)}
        from typed where ${inPeriod(sql`typed_at`)}`),
      this.rows<{ n: number }>(sql`select count(*)::int as n from items i where i.discarded and ${inPeriod(sql`i.created_at`)}`),
      this.rows<{ name: string; email: string; count: number }>(sql`
        select u.name, u.email, count(*)::int as count
        from items i join users u on u.id = i.reporter_id
        where i.discarded = false and ${inPeriod(sql`i.created_at`)} and ${inScope}
        group by u.id, u.name, u.email
        order by count desc, u.name
        limit 10`),
      this.rows<{ label: string | null; icon: string | null; type: ItemType | null; count: number }>(sql`
        select c.label, c.icon, i.type::text as type, count(*)::int as count
        from items i left join channels c on c.id = i.channel_id
        where i.discarded = false and ${inPeriod(sql`i.created_at`)} and ${inScope}
        group by c.id, c.label, c.icon, c.position, i.type
        order by c.position nulls last`),
    ]);

    const total = openCount[0]?.total ?? 0;
    const backlog = openCount[0]?.backlog ?? 0;
    const closedRows = closed.reduce((sum, r) => sum + r.n, 0);
    return {
      backlogLabel: backlogStatus[0]?.label ?? null,
      totals: {
        created: created.reduce((sum, r) => sum + r.n, 0),
        closed: closedRows,
        rejected: closed.filter((r) => r.rejected).reduce((sum, r) => sum + r.n, 0),
        openNow: p.scope === 'task' ? total - backlog : total,
        backlog: p.scope === 'task' ? backlog : 0,
        reopened: reopened[0]?.n ?? 0,
        discarded: discarded[0]?.n ?? 0,
      },
      flow,
      open: { inbox: p.scope === 'all' ? (inbox[0]?.n ?? 0) : 0, byStatus, byPriority, byAssignee: sortAssignees(byAssignee) },
      oldest: { total: oldestTotal[0]?.n ?? 0, items: oldest },
      overdue: { total: overdueTotal[0]?.n ?? 0, items: overdue },
      resolution: {
        ...toStats(resolution.find((r) => r.priority === null)),
        byPriority: resolution.filter((r) => r.priority !== null).map((r) => ({ priority: r.priority!, ...toStats(r) })),
      },
      firstReply: toStats(firstReply[0]),
      cycleTime: toStats(cycleTime[0]),
      triage: toStats(triage[0]),
      topReporters,
      byChannel,
    };
  }

  /** CSV für Excel: alle im Zeitraum erfassten Vorgänge der Ansicht, Semikolon getrennt, mit BOM. */
  async csv(p: ReportPeriod): Promise<string> {
    const inScope = p.scope === 'all' ? sql`true` : sql`i.type::text = ${p.scope}`;
    const rows = await this.rows<{
      number: number;
      type: ItemType | null;
      title: string;
      status: string | null;
      priority: Priority;
      reporter: string;
      reporterEmail: string;
      assignee: string | null;
      channel: string | null;
      createdAt: Date;
      closedAt: Date | null;
    }>(sql`
      select i.number, i.type::text as type, i.title, s.label as status, i.priority::text as priority,
        r.name as reporter, r.email as "reporterEmail", a.name as assignee, c.label as channel,
        i.created_at as "createdAt", i.closed_at as "closedAt"
      from items i
      left join statuses s on s.id = i.status_id
      join users r on r.id = i.reporter_id
      left join users a on a.id = i.assignee_id
      left join channels c on c.id = i.channel_id
      where i.discarded = false and i.created_at >= ${p.from.toISOString()}::timestamptz and i.created_at < ${p.to.toISOString()}::timestamptz
        and ${inScope}
      order by i.number`);
    const dateTime = new Intl.DateTimeFormat('de-CH', {
      timeZone: p.timeZone,
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
    const header = ['Nummer', 'Typ', 'Titel', 'Status', 'Priorität', 'Melder', 'E-Mail Melder', 'Zuständig', 'Meldeweg', 'Erfasst', 'Abgeschlossen'];
    const lines = rows.map((r) => [
      `PW-${r.number}`,
      r.type ? TYPE_LABELS[r.type] : 'Eingang',
      r.title,
      r.status ?? '',
      PRIORITY_LABELS[r.priority],
      r.reporter,
      r.reporterEmail,
      r.assignee ?? '',
      r.channel ?? '',
      dateTime.format(new Date(r.createdAt)),
      r.closedAt ? dateTime.format(new Date(r.closedAt)) : '',
    ]);
    return '﻿' + [header, ...lines].map((cells) => cells.map(csvCell).join(';')).join('\r\n') + '\r\n';
  }
}

/** Zuständige nach Anzahl offener Vorgänge (über alle Typen), «niemand» bei Gleichstand zuerst, dann nach Name */
export function sortAssignees<T extends { id: string | null; name: string | null; type: string | null; count: number }>(rows: T[]): T[] {
  const totals = new Map<string | null, number>();
  for (const r of rows) totals.set(r.id, (totals.get(r.id) ?? 0) + r.count);
  const person = (a: T, b: T) => {
    if (a.id === b.id) return 0;
    if (a.id === null) return -1;
    if (b.id === null) return 1;
    return (a.name ?? '').localeCompare(b.name ?? '', 'de') || a.id.localeCompare(b.id);
  };
  return [...rows].sort((a, b) => totals.get(b.id)! - totals.get(a.id)! || person(a, b) || (a.type ?? '').localeCompare(b.type ?? ''));
}

/** Feld für CSV: in Anführungszeichen, wenn nötig; Formeln werden entschärft (CSV-Injection). */
export function csvCell(value: string): string {
  let v = value;
  if (/^[=+\-@\t\r]/.test(v)) v = `'${v}`;
  return /[;"\r\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
}
