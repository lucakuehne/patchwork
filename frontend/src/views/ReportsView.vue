<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { api } from '../api';
import ReportChart from '../components/ReportChart.vue';
import { barChartHeight, chartImage, type ChartSpec } from '../charts';
import { formatDate, itemRef, PRIORITY_LABELS, TYPE_LABELS } from '../format';
import {
  bucketFor,
  bucketLabel,
  customPeriod,
  dayString,
  PERIOD_LABELS,
  periodText,
  presetPeriod,
  type Period,
  type PeriodKey,
} from '../periods';
import { useSession } from '../stores/session';
import { useToast } from '../stores/toast';
import type { Priority, Report } from '../types';

const session = useSession();
const toast = useToast();

const periodKey = ref<PeriodKey>('thisMonth');
const customFrom = ref(dayString(presetPeriod('thisMonth').from));
const customTo = ref(dayString(new Date()));
const report = ref<Report | null>(null);
const loading = ref(false);
const exporting = ref(false);

const period = computed<Period | null>(() =>
  periodKey.value === 'custom' ? customPeriod(customFrom.value, customTo.value) : presetPeriod(periodKey.value),
);
const bucket = computed(() => (period.value ? bucketFor(period.value) : 'day'));
const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
const query = computed(() => {
  const p = period.value;
  if (!p) return '';
  const params = new URLSearchParams({ from: p.from.toISOString(), to: p.to.toISOString(), tz: timeZone, bucket: bucket.value });
  return params.toString();
});

async function load() {
  if (!query.value) return;
  loading.value = true;
  try {
    report.value = await api.get<Report>(`/admin/reports?${query.value}`);
  } catch (err) {
    toast.error(err);
  } finally {
    loading.value = false;
  }
}
watch(query, load, { immediate: true });

// ---------------------------------------------------------------- Darstellung

const COLORS = {
  incident: '#c93a3a',
  incidentLight: '#ec9a9a',
  task: '#2f5bea',
  taskLight: '#9fb5f5',
  inbox: '#9aa4b2',
};
const number = new Intl.NumberFormat('de-CH', { maximumFractionDigits: 1 });

function duration(hours: number | null): string {
  if (hours === null) return '–';
  if (hours < 1) return `${Math.max(1, Math.round(hours * 60))} Min.`;
  if (hours < 48) return `${number.format(hours)} Std.`;
  return `${number.format(hours / 24)} Tage`;
}

const flowSpec = computed<ChartSpec | null>(() => {
  const r = report.value;
  if (!r) return null;
  return {
    title: 'Neue und abgeschlossene Vorgänge',
    stacked: true,
    labels: r.flow.map((f) => bucketLabel(f.start, bucket.value)),
    datasets: [
      { label: 'Neu: Störung', data: r.flow.map((f) => f.created.incident), color: COLORS.incident, stack: 'neu' },
      { label: 'Neu: Aufgabe', data: r.flow.map((f) => f.created.task), color: COLORS.task, stack: 'neu' },
      { label: 'Neu: Eingang', data: r.flow.map((f) => f.created.inbox), color: COLORS.inbox, stack: 'neu' },
      { label: 'Abgeschlossen: Störung', data: r.flow.map((f) => f.closed.incident), color: COLORS.incidentLight, stack: 'zu' },
      { label: 'Abgeschlossen: Aufgabe', data: r.flow.map((f) => f.closed.task), color: COLORS.taskLight, stack: 'zu' },
    ],
  };
});

const statusSpec = computed<ChartSpec | null>(() => {
  const r = report.value;
  if (!r) return null;
  const rows = [
    ...(r.open.inbox ? [{ label: 'Eingang', count: r.open.inbox, color: COLORS.inbox }] : []),
    ...r.open.byStatus.map((s) => ({
      label: `${TYPE_LABELS[s.type]}: ${s.label}`,
      count: s.count,
      color: s.type === 'incident' ? COLORS.incident : COLORS.task,
    })),
  ];
  return {
    title: 'Offene Vorgänge nach Status',
    horizontal: true,
    labels: rows.map((x) => x.label),
    datasets: [{ label: 'Offen', data: rows.map((x) => x.count), color: rows.map((x) => x.color) }],
  };
});

const assigneeSpec = computed<ChartSpec | null>(() => {
  const r = report.value;
  if (!r) return null;
  return {
    title: 'Offene Vorgänge nach Zuständigem',
    horizontal: true,
    labels: r.open.byAssignee.map((a) => a.name ?? 'niemand'),
    datasets: [{ label: 'Offen', data: r.open.byAssignee.map((a) => a.count), color: COLORS.task }],
  };
});

const priorities = computed(() =>
  (['high', 'normal', 'low'] as Priority[]).map((p) => ({
    priority: p,
    count: report.value?.open.byPriority.find((x) => x.priority === p)?.count ?? 0,
  })),
);

const ageDays = (iso: string) => Math.floor((Date.now() - new Date(iso).getTime()) / (24 * 3600 * 1000));

// ---------------------------------------------------------------- Export

const fileRange = computed(() => {
  const p = period.value;
  return p ? `${dayString(p.from)}-bis-${dayString(new Date(p.to.getTime() - 1))}` : '';
});

function download(url: string, filename: string) {
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
}

const slug = (s: string) =>
  s
    .toLowerCase()
    .replace(/ä/g, 'ae')
    .replace(/ö/g, 'oe')
    .replace(/ü/g, 'ue')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '');

function exportChart(spec: ChartSpec, height: number) {
  const width = 1200;
  download(chartImage(spec, width, Math.round((height / 700) * width) + 120), `patchwork-${slug(spec.title)}-${fileRange.value}.png`);
}

async function exportPdf() {
  const r = report.value;
  const p = period.value;
  if (!r || !p || !flowSpec.value || !statusSpec.value || !assigneeSpec.value) return;
  exporting.value = true;
  try {
    const { reportPdf } = await import('../report-pdf');
    const blob = await reportPdf({
      title: 'Auswertung',
      subtitle: `${session.appName} · ${PERIOD_LABELS[periodKey.value]}: ${periodText(p)}`,
      facts: [
        ['Neue Vorgänge', String(r.totals.created)],
        ['Abgeschlossene Vorgänge', String(r.totals.closed)],
        ['Aktuell offen', String(r.totals.openNow)],
        [
          'Dauer bis «Gelöst»',
          r.resolution.count
            ? `Median ${duration(r.resolution.medianHours)}, Durchschnitt ${duration(r.resolution.averageHours)} (${r.resolution.count} Störungen)`
            : '–',
        ],
      ],
      charts: [
        { spec: flowSpec.value, height: 95 },
        { spec: statusSpec.value, height: Math.min(150, 25 + statusSpec.value.labels.length * 9) },
        { spec: assigneeSpec.value, height: Math.min(150, 25 + assigneeSpec.value.labels.length * 9) },
      ],
      tables: [
        {
          title: 'Offene Vorgänge nach Priorität',
          head: ['Priorität', 'Anzahl'],
          body: priorities.value.map((x) => [PRIORITY_LABELS[x.priority], String(x.count)]),
          empty: '',
        },
        {
          title: `Älteste offene Vorgänge (über 30 Tage, ${r.oldest.total} insgesamt)`,
          head: ['Nummer', 'Titel', 'Status', 'Zuständig', 'Offen seit'],
          body: r.oldest.items.map((i) => [
            itemRef(i.number),
            i.title,
            i.status ?? 'Eingang',
            i.assignee ?? '–',
            `${ageDays(i.createdAt)} Tagen`,
          ]),
          empty: 'Keine Vorgänge, die länger als 30 Tage offen sind.',
        },
        {
          title: 'Häufigste Melder im Zeitraum',
          head: ['Name', 'E-Mail', 'Meldungen'],
          body: r.topReporters.map((x) => [x.name, x.email, String(x.count)]),
          empty: 'Keine Meldungen im Zeitraum.',
        },
      ],
    });
    const url = URL.createObjectURL(blob);
    download(url, `patchwork-auswertung-${fileRange.value}.pdf`);
    setTimeout(() => URL.revokeObjectURL(url), 10_000);
  } catch (err) {
    toast.error(err);
  } finally {
    exporting.value = false;
  }
}
</script>

<template>
  <div class="page stack">
    <div class="page-head">
      <h1>Auswertungen</h1>
      <div class="spacer" />
      <select v-model="periodKey" class="select period" aria-label="Zeitraum">
        <option v-for="(label, key) in PERIOD_LABELS" :key="key" :value="key">{{ label }}</option>
      </select>
      <template v-if="periodKey === 'custom'">
        <input v-model="customFrom" class="input date" type="date" aria-label="Von" />
        <span class="muted">bis</span>
        <input v-model="customTo" class="input date" type="date" aria-label="Bis" />
      </template>
      <a v-if="query" class="btn" :href="`/api/admin/reports/items.csv?${query}`" download>CSV</a>
      <button class="btn btn-primary" type="button" :disabled="!report || exporting" @click="exportPdf">
        {{ exporting ? 'PDF wird erstellt …' : 'PDF' }}
      </button>
    </div>
    <p v-if="period" class="muted period-text">
      {{ periodText(period) }}. «Aktuell offen» und die Verteilungen gelten für heute, alles andere für den Zeitraum.
    </p>
    <div v-else class="error-box">Bitte einen gültigen Zeitraum wählen.</div>

    <div v-if="report" class="stack" :class="{ loading }">
      <div class="facts">
        <div class="card fact">
          <span class="fact-value">{{ report.totals.created }}</span>
          <span class="muted">Neue Vorgänge</span>
        </div>
        <div class="card fact">
          <span class="fact-value">{{ report.totals.closed }}</span>
          <span class="muted">Abgeschlossen</span>
        </div>
        <div class="card fact">
          <span class="fact-value">{{ report.totals.openNow }}</span>
          <span class="muted">Aktuell offen</span>
        </div>
        <div class="card fact">
          <span class="fact-value">{{ duration(report.resolution.medianHours) }}</span>
          <span class="muted">Typische Dauer bis «Gelöst»</span>
          <span v-if="report.resolution.count" class="faint small">
            Median aus {{ report.resolution.count }} Störungen, Durchschnitt {{ duration(report.resolution.averageHours) }}
          </span>
        </div>
      </div>

      <section v-if="flowSpec" class="card card-body">
        <div class="row section-head">
          <h2>{{ flowSpec.title }}</h2>
          <span class="spacer" />
          <button class="btn btn-sm" type="button" @click="exportChart(flowSpec, 320)">Als Bild</button>
        </div>
        <ReportChart :spec="flowSpec" :height="320" />
      </section>

      <div class="two">
        <section v-if="statusSpec" class="card card-body">
          <div class="row section-head">
            <h2>{{ statusSpec.title }}</h2>
            <span class="spacer" />
            <button class="btn btn-sm" type="button" @click="exportChart(statusSpec, barChartHeight(statusSpec.labels.length))">
              Als Bild
            </button>
          </div>
          <ReportChart v-if="statusSpec.labels.length" :spec="statusSpec" :height="barChartHeight(statusSpec.labels.length)" />
          <div v-else class="faint">Keine offenen Vorgänge.</div>
        </section>
        <section v-if="assigneeSpec" class="card card-body">
          <div class="row section-head">
            <h2>{{ assigneeSpec.title }}</h2>
            <span class="spacer" />
            <button class="btn btn-sm" type="button" @click="exportChart(assigneeSpec, barChartHeight(assigneeSpec.labels.length))">
              Als Bild
            </button>
          </div>
          <ReportChart v-if="assigneeSpec.labels.length" :spec="assigneeSpec" :height="barChartHeight(assigneeSpec.labels.length)" />
          <div v-else class="faint">Keine offenen Vorgänge.</div>
        </section>
      </div>

      <div class="two">
        <section class="card card-body">
          <h2>Offene Vorgänge nach Priorität</h2>
          <table class="table">
            <tbody>
              <tr v-for="p in priorities" :key="p.priority">
                <td>{{ PRIORITY_LABELS[p.priority] }}</td>
                <td class="num">{{ p.count }}</td>
              </tr>
            </tbody>
          </table>
        </section>
        <section class="card card-body">
          <h2>Häufigste Melder im Zeitraum</h2>
          <table v-if="report.topReporters.length" class="table">
            <tbody>
              <tr v-for="x in report.topReporters" :key="x.email">
                <td>
                  {{ x.name }} <span class="faint small">{{ x.email }}</span>
                </td>
                <td class="num">{{ x.count }}</td>
              </tr>
            </tbody>
          </table>
          <div v-else class="faint">Keine Meldungen im Zeitraum.</div>
        </section>
      </div>

      <section class="card card-body">
        <h2>Älteste offene Vorgänge <span class="faint small">über 30 Tage offen, {{ report.oldest.total }} insgesamt</span></h2>
        <table v-if="report.oldest.items.length" class="table">
          <thead>
            <tr>
              <th>Nummer</th>
              <th>Titel</th>
              <th>Status</th>
              <th>Zuständig</th>
              <th>Erfasst</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="i in report.oldest.items" :key="i.number">
              <td>
                <RouterLink :to="`/v/${i.number}`" class="mono">{{ itemRef(i.number) }}</RouterLink>
              </td>
              <td class="title-cell">{{ i.title }}</td>
              <td>{{ i.status ?? 'Eingang' }}</td>
              <td>{{ i.assignee ?? '–' }}</td>
              <td>{{ formatDate(i.createdAt) }} <span class="faint small">({{ ageDays(i.createdAt) }} Tage)</span></td>
            </tr>
          </tbody>
        </table>
        <div v-else class="faint">Keine Vorgänge, die länger als 30 Tage offen sind.</div>
      </section>
    </div>
  </div>
</template>

<style scoped>
.page-head {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}
.period {
  width: auto;
}
.date {
  width: 150px;
}
.period-text {
  margin: 0;
  font-size: 13px;
}
.loading {
  opacity: 0.6;
}
.facts {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
  gap: 12px;
}
.fact {
  display: flex;
  flex-direction: column;
  gap: 2px;
  padding: 14px 16px;
}
.fact-value {
  font-size: 26px;
  font-weight: 700;
}
.small {
  font-size: 12px;
}
.section-head {
  margin-bottom: 8px;
}
h2 {
  font-size: 15px;
}
.two {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(320px, 1fr));
  gap: 12px;
}
.table {
  width: 100%;
  border-collapse: collapse;
  font-size: 13px;
  margin-top: 6px;
}
.table th,
.table td {
  text-align: left;
  padding: 6px 8px;
  border-bottom: 1px solid var(--border);
}
.table th {
  color: var(--text-muted);
  font-weight: 600;
}
.num {
  text-align: right !important;
  font-variant-numeric: tabular-nums;
}
.title-cell {
  overflow-wrap: anywhere;
}
</style>
