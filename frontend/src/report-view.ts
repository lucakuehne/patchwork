import type { ChartSpec } from './charts';
import { PRIORITY_LABELS, TYPE_LABELS } from './format';
import { bucketLabel, type Bucket } from './periods';
import type { DurationStats, ItemType, Priority, Report, ReportScope } from './types';

/**
 * Auswertungen je Ansicht (Störungen, Aufgaben, Alle): Kennzahlen, Diagramme und Tabellen für Bildschirm und PDF.
 * Welche Karte wo erscheint, steht in docs/Entscheidungen.md («Auswertungen nach Störungen, Aufgaben und Alle»).
 */

export const SCOPES: { value: ReportScope; label: string }[] = [
  { value: 'incident', label: 'Störungen' },
  { value: 'task', label: 'Aufgaben' },
  { value: 'all', label: 'Alle' },
];

/** Bezeichnung der Vorgänge einer Ansicht im Plural, z.B. «Offene Störungen nach Status» */
export const SCOPE_NOUNS: Record<ReportScope, string> = { incident: 'Störungen', task: 'Aufgaben', all: 'Vorgänge' };

export const COLORS = {
  incident: '#c93a3a',
  incidentLight: '#ec9a9a',
  task: '#2f5bea',
  taskLight: '#9fb5f5',
  inbox: '#9aa4b2',
  rejected: '#c5ccd6',
};

const TYPE_COLORS: Record<ItemType | 'inbox', string> = { incident: COLORS.incident, task: COLORS.task, inbox: COLORS.inbox };
const PRIORITIES: Priority[] = ['high', 'normal', 'low'];

const number = new Intl.NumberFormat('de-CH', { maximumFractionDigits: 1 });

export function duration(hours: number | null): string {
  if (hours === null) return '–';
  if (hours < 1) return `${Math.max(1, Math.round(hours * 60))} Min.`;
  if (hours < 48) return `${number.format(hours)} Std.`;
  return `${number.format(hours / 24)} Tage`;
}

export interface Fact {
  label: string;
  value: string;
  hint?: string;
}

/** Median als Wert, Anzahl und Durchschnitt als Hinweis */
function durationFact(label: string, stats: DurationStats, of: string): Fact {
  return {
    label,
    value: duration(stats.medianHours),
    hint: stats.count ? `Median aus ${stats.count} ${of}, Durchschnitt ${duration(stats.averageHours)}` : undefined,
  };
}

/** «ohne «Backlog»»: der Start-Status der Aufgaben mit seinem aktuellen Namen */
export const withoutBacklog = (r: Report) => `ohne «${r.backlogLabel ?? 'Backlog'}»`;

export function facts(r: Report, scope: ReportScope): Fact[] {
  const t = r.totals;
  if (scope === 'incident') {
    return [
      { label: 'Neue Störungen', value: String(t.created) },
      { label: 'Gelöst', value: String(t.closed - t.rejected) },
      { label: 'Aktuell offen', value: String(t.openNow) },
      { label: 'Wiedereröffnet', value: String(t.reopened), hint: 'Gelöste Störungen, die wieder aufgingen' },
      durationFact('Typische Dauer bis «Gelöst»', r.resolution, 'Störungen'),
      durationFact('Erste Antwort', r.firstReply, 'Störungen'),
    ];
  }
  if (scope === 'task') {
    return [
      { label: 'Neue Aufgaben', value: String(t.created) },
      { label: 'Erledigt', value: String(t.closed - t.rejected) },
      { label: 'Abgelehnt', value: String(t.rejected) },
      { label: 'Aktuell offen', value: String(t.openNow), hint: withoutBacklog(r) },
      { label: r.backlogLabel ?? 'Backlog', value: String(t.backlog), hint: 'Offen, noch nicht eingeplant' },
      { label: 'Überfällig', value: String(r.overdue.total), hint: 'Offen, Fälligkeit vorbei' },
      durationFact('Durchlaufzeit', r.cycleTime, `Aufgaben, ab «${r.backlogLabel ?? 'Backlog'}» bis «Erledigt»`),
    ];
  }
  return [
    { label: 'Neue Vorgänge', value: String(t.created) },
    { label: 'Abgeschlossen', value: String(t.closed) },
    { label: 'Aktuell offen', value: String(t.openNow), hint: 'Mit Eingang' },
    { label: 'Verworfen', value: String(t.discarded), hint: 'Im Zeitraum eingegangen' },
    durationFact('Zeit bis zur Zuordnung', r.triage, 'Vorgängen im Eingang'),
  ];
}

export function flowSpec(r: Report, scope: ReportScope, bucket: Bucket): ChartSpec {
  const labels = r.flow.map((f) => bucketLabel(f.start, bucket));
  const series = (pick: (f: Report['flow'][number]) => number) => r.flow.map(pick);
  if (scope === 'incident') {
    const rejected = series((f) => f.rejected.incident);
    return {
      title: 'Neue und gelöste Störungen',
      stacked: true,
      labels,
      datasets: [
        { label: 'Neu', data: series((f) => f.created.incident), color: COLORS.incident, stack: 'neu' },
        { label: 'Gelöst', data: series((f) => f.closed.incident), color: COLORS.incidentLight, stack: 'zu' },
        // Störungen haben standardmässig keinen Ablehnen-Status
        ...(rejected.some(Boolean) ? [{ label: 'Abgelehnt', data: rejected, color: COLORS.rejected, stack: 'zu' }] : []),
      ],
    };
  }
  if (scope === 'task') {
    return {
      title: 'Neue und abgeschlossene Aufgaben',
      stacked: true,
      labels,
      datasets: [
        { label: 'Neu', data: series((f) => f.created.task), color: COLORS.task, stack: 'neu' },
        { label: 'Erledigt', data: series((f) => f.closed.task), color: COLORS.taskLight, stack: 'zu' },
        { label: 'Abgelehnt', data: series((f) => f.rejected.task), color: COLORS.rejected, stack: 'zu' },
      ],
    };
  }
  return {
    title: 'Neue und abgeschlossene Vorgänge',
    stacked: true,
    labels,
    datasets: [
      { label: 'Neu: Störung', data: series((f) => f.created.incident), color: COLORS.incident, stack: 'neu' },
      { label: 'Neu: Aufgabe', data: series((f) => f.created.task), color: COLORS.task, stack: 'neu' },
      { label: 'Neu: Eingang', data: series((f) => f.created.inbox), color: COLORS.inbox, stack: 'neu' },
      {
        label: 'Abgeschlossen: Störung',
        data: series((f) => f.closed.incident + f.rejected.incident),
        color: COLORS.incidentLight,
        stack: 'zu',
      },
      { label: 'Abgeschlossen: Aufgabe', data: series((f) => f.closed.task + f.rejected.task), color: COLORS.taskLight, stack: 'zu' },
    ],
  };
}

export function statusSpec(r: Report, scope: ReportScope): ChartSpec {
  const rows = [
    ...(scope === 'all' && r.open.inbox ? [{ label: 'Eingang', count: r.open.inbox, color: COLORS.inbox }] : []),
    ...r.open.byStatus.map((s) => ({
      label: scope === 'all' ? `${TYPE_LABELS[s.type]}: ${s.label}` : s.label,
      count: s.count,
      color: TYPE_COLORS[s.type],
    })),
  ];
  return {
    title: `Offene ${SCOPE_NOUNS[scope]} nach Status`,
    horizontal: true,
    labels: rows.map((x) => x.label),
    datasets: [{ label: 'Offen', data: rows.map((x) => x.count), color: rows.map((x) => x.color) }],
  };
}

/**
 * Waagrechte Balken je Kategorie; bei «Alle» nach Typ gestapelt (Störung, Aufgabe, Eingang), sonst eine Reihe in der
 * Farbe des Typs.
 */
function byTypeSpec<K>(
  title: string,
  scope: ReportScope,
  seriesLabel: string,
  rows: { key: K; label: string; type: ItemType | null; count: number }[],
): ChartSpec {
  const keys: K[] = [];
  const labels: string[] = [];
  for (const row of rows) {
    if (!keys.includes(row.key)) {
      keys.push(row.key);
      labels.push(row.label);
    }
  }
  const data = (type: ItemType | null) => keys.map((k) => rows.filter((x) => x.key === k && x.type === type).reduce((sum, x) => sum + x.count, 0));
  if (scope !== 'all') return { title, horizontal: true, labels, datasets: [{ label: seriesLabel, data: data(scope), color: TYPE_COLORS[scope] }] };
  const datasets = [
    { label: 'Störung', data: data('incident'), color: COLORS.incident },
    { label: 'Aufgabe', data: data('task'), color: COLORS.task },
    { label: 'Eingang', data: data(null), color: COLORS.inbox },
  ].filter((d) => d.data.some(Boolean));
  return { title, horizontal: true, stacked: true, labels, datasets };
}

export function assigneeSpec(r: Report, scope: ReportScope): ChartSpec {
  const title = `Offene ${SCOPE_NOUNS[scope]} nach Zuständigem${scope === 'task' ? ` (${withoutBacklog(r)})` : ''}`;
  return byTypeSpec(
    title,
    scope,
    'Offen',
    r.open.byAssignee.map((a) => ({ key: a.id, label: a.name ?? 'niemand', type: a.type, count: a.count })),
  );
}

export function channelSpec(r: Report, scope: ReportScope): ChartSpec {
  return byTypeSpec(
    `Neue ${SCOPE_NOUNS[scope]} nach Meldeweg`,
    scope,
    'Neu',
    r.byChannel.map((c) => ({ key: c.label, label: c.label ?? 'ohne Angabe', type: c.type, count: c.count })),
  );
}

export interface SimpleTable {
  head: string[];
  rows: string[][];
}

/** Offene nach Priorität; bei «Alle» je Typ und gesamt */
export function priorityTable(r: Report, scope: ReportScope): SimpleTable {
  const count = (p: Priority, type?: ItemType | null) =>
    r.open.byPriority.filter((x) => x.priority === p && (type === undefined || x.type === type)).reduce((sum, x) => sum + x.count, 0);
  if (scope !== 'all') return { head: ['Priorität', 'Anzahl'], rows: PRIORITIES.map((p) => [PRIORITY_LABELS[p], String(count(p))]) };
  return {
    head: ['Priorität', 'Störungen', 'Aufgaben', 'Eingang', 'Total'],
    rows: PRIORITIES.map((p) => [
      PRIORITY_LABELS[p],
      String(count(p, 'incident')),
      String(count(p, 'task')),
      String(count(p, null)),
      String(count(p)),
    ]),
  };
}

/** Störungen: Dauer bis «Gelöst» je Priorität */
export function resolutionTable(r: Report): SimpleTable {
  return {
    head: ['Priorität', 'Störungen', 'Median', 'Durchschnitt'],
    rows: PRIORITIES.map((p) => {
      const s = r.resolution.byPriority.find((x) => x.priority === p);
      return [PRIORITY_LABELS[p], String(s?.count ?? 0), duration(s?.medianHours ?? null), duration(s?.averageHours ?? null)];
    }),
  };
}

/** Titel der Liste der ältesten offenen Vorgänge mit Hinweis */
export function oldestHint(r: Report, scope: ReportScope): string {
  return `über 30 Tage offen, ${r.oldest.total} insgesamt${scope === 'task' ? `, ${withoutBacklog(r)}` : ''}`;
}

/** Tage seit einem Datum (YYYY-MM-DD oder ISO), z.B. für «3 Tage überfällig» */
export function daysSince(value: string, now = new Date()): number {
  const day = /^\d{4}-\d{2}-\d{2}$/.test(value) ? new Date(`${value}T00:00:00`) : new Date(value);
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const start = new Date(day.getFullYear(), day.getMonth(), day.getDate());
  return Math.round((today.getTime() - start.getTime()) / (24 * 3600 * 1000));
}
