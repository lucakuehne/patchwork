import { describe, expect, it } from 'vitest';
import { assigneeSpec, channelSpec, daysSince, duration, facts, flowSpec, priorityTable, resolutionTable, statusSpec } from './report-view';
import type { Report } from './types';

const none = { count: 0, medianHours: null, averageHours: null };

function report(overrides: Partial<Report> = {}): Report {
  return {
    backlogLabel: 'Backlog',
    totals: { created: 10, closed: 6, rejected: 2, openNow: 7, backlog: 4, reopened: 1, discarded: 3 },
    flow: [
      { start: '2026-10-26', created: { incident: 3, task: 2, inbox: 1 }, closed: { incident: 2, task: 1 }, rejected: { incident: 0, task: 1 } },
    ],
    open: {
      inbox: 2,
      byStatus: [
        { type: 'incident', label: 'Neu', closed: false, count: 3 },
        { type: 'task', label: 'Backlog', closed: false, count: 4 },
      ],
      byPriority: [
        { priority: 'high', type: 'incident', count: 2 },
        { priority: 'high', type: null, count: 1 },
        { priority: 'normal', type: 'task', count: 5 },
      ],
      byAssignee: [
        { id: null, name: null, type: 'incident', count: 2 },
        { id: null, name: null, type: null, count: 1 },
        { id: 'u1', name: 'Ivan IT', type: 'task', count: 3 },
      ],
    },
    oldest: { total: 0, items: [] },
    overdue: { total: 2, items: [] },
    resolution: { count: 4, medianHours: 3, averageHours: 5, byPriority: [{ priority: 'high', count: 1, medianHours: 0.5, averageHours: 0.5 }] },
    firstReply: { count: 3, medianHours: 1.5, averageHours: 2 },
    cycleTime: { count: 2, medianHours: 72, averageHours: 96 },
    triage: none,
    topReporters: [],
    byChannel: [
      { label: 'E-Mail', icon: 'mail', type: 'incident', count: 2 },
      { label: 'E-Mail', icon: 'mail', type: 'task', count: 1 },
      { label: null, icon: null, type: null, count: 1 },
    ],
    ...overrides,
  };
}

describe('Kennzahlen je Ansicht', () => {
  it('Störungen: gelöst ohne abgelehnte, wiedereröffnet, Dauer und erste Antwort', () => {
    const f = facts(report(), 'incident');
    expect(f.map((x) => [x.label, x.value])).toEqual([
      ['Neue Störungen', '10'],
      ['Gelöst', '4'],
      ['Aktuell offen', '7'],
      ['Wiedereröffnet', '1'],
      ['Typische Dauer bis «Gelöst»', '3 Std.'],
      ['Erste Antwort', '1.5 Std.'],
    ]);
    expect(f[4]!.hint).toBe('Median aus 4 Störungen, Durchschnitt 5 Std.');
  });

  it('Aufgaben: erledigt und abgelehnt getrennt, Backlog mit seinem Namen, überfällig, Durchlaufzeit', () => {
    const f = facts(report({ backlogLabel: 'Ideen' }), 'task');
    expect(f.map((x) => [x.label, x.value])).toEqual([
      ['Neue Aufgaben', '10'],
      ['Erledigt', '4'],
      ['Abgelehnt', '2'],
      ['Aktuell offen', '7'],
      ['Ideen', '4'],
      ['Überfällig', '2'],
      ['Durchlaufzeit', '3 Tage'],
    ]);
    expect(f[3]!.hint).toBe('ohne «Ideen»');
  });

  it('Alle: abgeschlossen gesamt, verworfen, Zeit bis zur Zuordnung ohne Daten', () => {
    const f = facts(report(), 'all');
    expect(f.map((x) => [x.label, x.value])).toEqual([
      ['Neue Vorgänge', '10'],
      ['Abgeschlossen', '6'],
      ['Aktuell offen', '7'],
      ['Verworfen', '3'],
      ['Zeit bis zur Zuordnung', '–'],
    ]);
    expect(f[4]!.hint).toBeUndefined();
  });
});

describe('Diagramme je Ansicht', () => {
  it('Verlauf: Störungen ohne leere Reihe «Abgelehnt», Aufgaben mit, Alle zählt Abgelehnte zu abgeschlossen', () => {
    expect(flowSpec(report(), 'incident', 'day').datasets.map((d) => d.label)).toEqual(['Neu', 'Gelöst']);
    expect(flowSpec(report(), 'task', 'day').datasets.map((d) => [d.label, d.data[0]])).toEqual([
      ['Neu', 2],
      ['Erledigt', 1],
      ['Abgelehnt', 1],
    ]);
    const all = flowSpec(report(), 'all', 'day').datasets;
    expect(all.find((d) => d.label === 'Abgeschlossen: Aufgabe')!.data).toEqual([2]);
  });

  it('Status: Eingang und Typ nur bei «Alle»', () => {
    expect(statusSpec(report(), 'all').labels).toEqual(['Eingang', 'Störung: Neu', 'Aufgabe: Backlog']);
    expect(statusSpec(report({ open: { ...report().open, byStatus: [report().open.byStatus[0]!] } }), 'incident').labels).toEqual(['Neu']);
  });

  it('Zuständige: bei «Alle» nach Typ gestapelt, sonst eine Reihe', () => {
    const all = assigneeSpec(report(), 'all');
    expect(all.stacked).toBe(true);
    expect(all.labels).toEqual(['niemand', 'Ivan IT']);
    expect(all.datasets.map((d) => [d.label, d.data])).toEqual([
      ['Störung', [2, 0]],
      ['Aufgabe', [0, 3]],
      ['Eingang', [1, 0]],
    ]);
    const tasks = assigneeSpec(report(), 'task');
    expect(tasks.title).toBe('Offene Aufgaben nach Zuständigem (ohne «Backlog»)');
    expect(tasks.datasets).toHaveLength(1);
  });

  it('Meldeweg: gleicher Meldeweg zusammengefasst, ohne Angabe benannt', () => {
    const all = channelSpec(report(), 'all');
    expect(all.labels).toEqual(['E-Mail', 'ohne Angabe']);
    expect(all.datasets.map((d) => d.data)).toEqual([
      [2, 0],
      [1, 0],
      [0, 1],
    ]);
  });
});

describe('Tabellen', () => {
  it('Priorität: bei «Alle» je Typ und gesamt', () => {
    expect(priorityTable(report(), 'all').rows[0]).toEqual(['Hoch', '2', '0', '1', '3']);
    expect(priorityTable(report(), 'task').rows).toEqual([
      ['Hoch', '3'],
      ['Normal', '5'],
      ['Niedrig', '0'],
    ]);
  });

  it('Dauer bis «Gelöst» je Priorität, fehlende Prioritäten mit Strich', () => {
    expect(resolutionTable(report()).rows).toEqual([
      ['Hoch', '1', '30 Min.', '30 Min.'],
      ['Normal', '0', '–', '–'],
      ['Niedrig', '0', '–', '–'],
    ]);
  });
});

describe('Hilfsfunktionen', () => {
  it('Dauer in Minuten, Stunden oder Tagen', () => {
    expect(duration(null)).toBe('–');
    expect(duration(0.01)).toBe('1 Min.');
    expect(duration(47)).toBe('47 Std.');
    expect(duration(60)).toBe('2.5 Tage');
  });

  it('Tage seit einem Datum, auch über die Zeitumstellung', () => {
    expect(daysSince('2026-10-20', new Date(2026, 9, 27, 8))).toBe(7);
    expect(daysSince('2026-10-24', new Date(2026, 9, 26, 0, 30))).toBe(2);
  });
});
