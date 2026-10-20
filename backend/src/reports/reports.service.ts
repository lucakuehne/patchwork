import { Injectable } from '@nestjs/common';
import { sql, type SQL } from 'drizzle-orm';
import { InjectDb, type Db } from '../db/db.module';
import type { ItemType, Priority, StatusCategory } from '../db/schema';
import { PRIORITY_LABELS, TYPE_LABELS } from '../items/items.service';

export type Bucket = 'day' | 'week' | 'month';

export interface ReportPeriod {
  from: Date;
  to: Date;
  /** IANA-Zeitzone der Oberfläche, für die Einteilung nach Tagen, Wochen und Monaten */
  timeZone: string;
  bucket: Bucket;
}

export interface Report {
  totals: { created: number; closed: number; openNow: number };
  /** Neue und abgeschlossene Vorgänge pro Tag, Woche oder Monat (Beginn als YYYY-MM-DD) */
  flow: { start: string; created: Record<ItemType | 'inbox', number>; closed: Record<ItemType, number> }[];
  open: {
    inbox: number;
    byStatus: { type: ItemType; label: string; category: StatusCategory; count: number }[];
    byPriority: { priority: Priority; count: number }[];
    byAssignee: { name: string | null; count: number }[];
  };
  oldest: { total: number; items: { number: number; title: string; type: ItemType | null; status: string | null; assignee: string | null; createdAt: Date }[] };
  /** Dauer bis «Gelöst» bei Störungen, die im Zeitraum gelöst wurden (keine abgelehnten) */
  resolution: { count: number; medianHours: number | null; averageHours: number | null };
  topReporters: { name: string; email: string; count: number }[];
  /** Neue Vorgänge im Zeitraum nach Meldeweg; label null = ohne Angabe */
  byChannel: { label: string | null; icon: string | null; count: number }[];
}

/** Offen = im Eingang (ohne Status) oder in einem Status ausserhalb «Erledigt»/«Abgelehnt» */
const OPEN = sql`i.discarded = false and (i.status_id is null or s.category not in ('done', 'rejected'))`;

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
    const bucketOf = (column: SQL) => sql`to_char(date_trunc(${p.bucket}, ${column} at time zone ${p.timeZone}), 'YYYY-MM-DD')`;

    const [starts, created, closed] = await Promise.all([
      this.rows<{ start: string }>(sql`
        select to_char(s, 'YYYY-MM-DD') as start from generate_series(
          date_trunc(${p.bucket}, ${from}::timestamptz at time zone ${p.timeZone}),
          date_trunc(${p.bucket}, (${to}::timestamptz - interval '1 second') at time zone ${p.timeZone}),
          ('1 ' || ${p.bucket})::interval
        ) as s`),
      this.rows<{ start: string; type: string; n: number }>(sql`
        select ${bucketOf(sql`i.created_at`)} as start, coalesce(i.type::text, 'inbox') as type, count(*)::int as n
        from items i
        where i.discarded = false and i.created_at >= ${from}::timestamptz and i.created_at < ${to}::timestamptz
        group by 1, 2`),
      this.rows<{ start: string; type: string; n: number }>(sql`
        select ${bucketOf(sql`i.closed_at`)} as start, i.type::text as type, count(*)::int as n
        from items i
        where i.discarded = false and i.type is not null and i.closed_at >= ${from}::timestamptz and i.closed_at < ${to}::timestamptz
        group by 1, 2`),
    ]);
    const flow = starts.map(({ start }) => ({
      start,
      created: { incident: 0, task: 0, inbox: 0 } as Record<ItemType | 'inbox', number>,
      closed: { incident: 0, task: 0 } as Record<ItemType, number>,
    }));
    const byStart = new Map(flow.map((f) => [f.start, f]));
    for (const r of created) {
      const f = byStart.get(r.start);
      if (f) f.created[r.type as ItemType | 'inbox'] += r.n;
    }
    for (const r of closed) {
      const f = byStart.get(r.start);
      if (f) f.closed[r.type as ItemType] += r.n;
    }

    const [byStatus, inbox, byPriority, byAssignee, oldest, oldestTotal, resolution, topReporters, byChannel] = await Promise.all([
      this.rows<{ type: ItemType; label: string; category: StatusCategory; count: number }>(sql`
        select s.type::text as type, s.label, s.category::text as category, count(i.id)::int as count
        from items i join statuses s on s.id = i.status_id
        where ${OPEN}
        group by s.id, s.type, s.label, s.category, s.position
        order by s.type, s.position`),
      this.rows<{ n: number }>(sql`select count(*)::int as n from items i where i.discarded = false and i.type is null`),
      this.rows<{ priority: Priority; count: number }>(sql`
        select i.priority::text as priority, count(*)::int as count
        from items i left join statuses s on s.id = i.status_id
        where ${OPEN}
        group by 1`),
      this.rows<{ name: string | null; count: number }>(sql`
        select u.name, count(*)::int as count
        from items i left join statuses s on s.id = i.status_id left join users u on u.id = i.assignee_id
        where ${OPEN}
        group by u.id, u.name
        order by count desc, u.name nulls first`),
      this.rows<{ number: number; title: string; type: ItemType | null; status: string | null; assignee: string | null; createdAt: Date }>(sql`
        select i.number, i.title, i.type::text as type, s.label as status, u.name as assignee, i.created_at as "createdAt"
        from items i left join statuses s on s.id = i.status_id left join users u on u.id = i.assignee_id
        where ${OPEN} and i.created_at < now() - interval '30 days'
        order by i.created_at asc
        limit 20`),
      this.rows<{ n: number }>(sql`
        select count(*)::int as n
        from items i left join statuses s on s.id = i.status_id
        where ${OPEN} and i.created_at < now() - interval '30 days'`),
      this.rows<{ count: number; median: number | null; average: number | null }>(sql`
        select count(*)::int as count,
          percentile_cont(0.5) within group (order by extract(epoch from i.closed_at - i.created_at)) / 3600 as median,
          avg(extract(epoch from i.closed_at - i.created_at)) / 3600 as average
        from items i join statuses s on s.id = i.status_id
        where i.discarded = false and i.type = 'incident' and s.category = 'done'
          and i.closed_at >= ${from}::timestamptz and i.closed_at < ${to}::timestamptz`),
      this.rows<{ name: string; email: string; count: number }>(sql`
        select u.name, u.email, count(*)::int as count
        from items i join users u on u.id = i.reporter_id
        where i.discarded = false and i.created_at >= ${from}::timestamptz and i.created_at < ${to}::timestamptz
        group by u.id, u.name, u.email
        order by count desc, u.name
        limit 10`),
      this.rows<{ label: string | null; icon: string | null; count: number }>(sql`
        select c.label, c.icon, count(*)::int as count
        from items i left join channels c on c.id = i.channel_id
        where i.discarded = false and i.created_at >= ${from}::timestamptz and i.created_at < ${to}::timestamptz
        group by c.id, c.label, c.icon, c.position
        order by c.position nulls last`),
    ]);

    const openNow = byStatus.reduce((sum, s) => sum + s.count, 0) + (inbox[0]?.n ?? 0);
    return {
      totals: {
        created: created.reduce((sum, r) => sum + r.n, 0),
        closed: closed.reduce((sum, r) => sum + r.n, 0),
        openNow,
      },
      flow,
      open: { inbox: inbox[0]?.n ?? 0, byStatus, byPriority, byAssignee },
      oldest: { total: oldestTotal[0]?.n ?? 0, items: oldest },
      resolution: {
        count: resolution[0]?.count ?? 0,
        medianHours: resolution[0]?.median === null || resolution[0]?.median === undefined ? null : Number(resolution[0].median),
        averageHours: resolution[0]?.average === null || resolution[0]?.average === undefined ? null : Number(resolution[0].average),
      },
      topReporters,
      byChannel,
    };
  }

  /** CSV für Excel: alle im Zeitraum erfassten Vorgänge, Semikolon getrennt, mit BOM. */
  async csv(p: ReportPeriod): Promise<string> {
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

/** Feld für CSV: in Anführungszeichen, wenn nötig; Formeln werden entschärft (CSV-Injection). */
export function csvCell(value: string): string {
  let v = value;
  if (/^[=+\-@\t\r]/.test(v)) v = `'${v}`;
  return /[;"\r\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
}
