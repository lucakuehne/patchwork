<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { api } from '../api';
import ItemLink from '../components/ItemLink.vue';
import ReportChart from '../components/ReportChart.vue';
import { barChartHeight, chartImage, type ChartSpec } from '../charts';
import { useReportScope } from '../composables';
import { formatDate, formatDay, itemRef } from '../format';
import {
  bucketFor,
  customPeriod,
  dayString,
  PERIOD_LABELS,
  periodText,
  presetPeriod,
  type Period,
  type PeriodKey,
} from '../periods';
import {
  assigneeSpec,
  channelSpec,
  daysSince,
  facts,
  flowSpec,
  oldestHint,
  priorityTable,
  resolutionTable,
  SCOPE_NOUNS,
  SCOPES,
  statusSpec,
  type SimpleTable,
} from '../report-view';
import { useSession } from '../stores/session';
import { useToast } from '../stores/toast';
import type { Report } from '../types';

const session = useSession();
const toast = useToast();

const scope = useReportScope();
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
  const params = new URLSearchParams({
    from: p.from.toISOString(),
    to: p.to.toISOString(),
    tz: timeZone,
    bucket: bucket.value,
    scope: scope.value,
  });
  return params.toString();
});

// Die Antwort gehört zur Ansicht, mit der sie geladen wurde (beim Umschalten nicht kurz die alte Ansicht neu deuten)
const loadedScope = ref(scope.value);
async function load() {
  if (!query.value) return;
  loading.value = true;
  const requested = scope.value;
  try {
    report.value = await api.get<Report>(`/admin/reports?${query.value}`);
    loadedScope.value = requested;
  } catch (err) {
    toast.error(err);
  } finally {
    loading.value = false;
  }
}
watch(query, load, { immediate: true });

// ---------------------------------------------------------------- Darstellung

const noun = computed(() => SCOPE_NOUNS[loadedScope.value]);
const factList = computed(() => (report.value ? facts(report.value, loadedScope.value) : []));
const flow = computed(() => (report.value ? flowSpec(report.value, loadedScope.value, bucket.value) : null));
const status = computed(() => (report.value ? statusSpec(report.value, loadedScope.value) : null));
const assignee = computed(() => (report.value ? assigneeSpec(report.value, loadedScope.value) : null));
const channel = computed(() => (report.value ? channelSpec(report.value, loadedScope.value) : null));
const priorities = computed<SimpleTable | null>(() => (report.value ? priorityTable(report.value, loadedScope.value) : null));
const resolution = computed<SimpleTable | null>(() => (report.value ? resolutionTable(report.value) : null));

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
  if (!r || !p || !flow.value || !status.value || !assignee.value || !channel.value || !priorities.value) return;
  const s = loadedScope.value;
  exporting.value = true;
  try {
    const { reportPdf } = await import('../report-pdf');
    const barHeight = (spec: ChartSpec) => Math.min(150, 25 + spec.labels.length * 9);
    const tables = [
      { title: `Offene ${noun.value} nach Priorität`, head: priorities.value.head, body: priorities.value.rows, empty: '' },
      ...(s === 'incident' && resolution.value
        ? [{ title: 'Dauer bis «Gelöst» je Priorität', head: resolution.value.head, body: resolution.value.rows, empty: '' }]
        : []),
      ...(s === 'task'
        ? [
            {
              title: `Überfällige Aufgaben (${r.overdue.total} insgesamt)`,
              head: ['Nummer', 'Titel', 'Status', 'Zuständig', 'Fällig'],
              body: r.overdue.items.map((i) => [itemRef(i.number), i.title, i.status, i.assignee ?? '–', overdueText(i.dueDate)]),
              empty: 'Keine überfälligen Aufgaben.',
            },
          ]
        : []),
      {
        title: 'Häufigste Melder im Zeitraum',
        head: ['Name', 'E-Mail', 'Meldungen'],
        body: r.topReporters.map((x) => [x.name, x.email, String(x.count)]),
        empty: 'Keine Meldungen im Zeitraum.',
      },
      {
        title: `Älteste offene ${noun.value} (${oldestHint(r, s)})`,
        head: ['Nummer', 'Titel', 'Status', 'Zuständig', 'Offen seit'],
        body: r.oldest.items.map((i) => [
          itemRef(i.number),
          i.title,
          i.status ?? 'Eingang',
          i.assignee ?? '–',
          `${daysSince(i.createdAt)} Tagen`,
        ]),
        empty: 'Keine, die länger als 30 Tage offen sind.',
      },
    ];
    const blob = await reportPdf({
      title: s === 'all' ? 'Auswertung' : `Auswertung ${noun.value}`,
      subtitle: `${session.appName} · ${PERIOD_LABELS[periodKey.value]}: ${periodText(p)}`,
      facts: factList.value.map((f) => [f.label, f.hint ? `${f.value} (${f.hint})` : f.value]),
      charts: [
        { spec: flow.value, height: 95 },
        { spec: status.value, height: barHeight(status.value) },
        { spec: assignee.value, height: barHeight(assignee.value) },
        { spec: channel.value, height: barHeight(channel.value) },
      ],
      tables,
    });
    const url = URL.createObjectURL(blob);
    const name = s === 'all' ? 'auswertung' : `auswertung-${slug(noun.value)}`;
    download(url, `patchwork-${name}-${fileRange.value}.pdf`);
    setTimeout(() => URL.revokeObjectURL(url), 10_000);
  } catch (err) {
    toast.error(err);
  } finally {
    exporting.value = false;
  }
}

function overdueText(dueDate: string): string {
  const days = daysSince(dueDate);
  return `${formatDay(dueDate)} (${days === 1 ? 'seit 1 Tag' : `seit ${days} Tagen`})`;
}
</script>

<template>
  <div class="page stack">
    <div class="page-head">
      <h1>Auswertungen</h1>
      <div class="segmented" role="group" aria-label="Ansicht">
        <button
          v-for="s in SCOPES"
          :key="s.value"
          type="button"
          :class="{ active: scope === s.value }"
          :aria-pressed="scope === s.value"
          @click="scope = s.value"
        >
          {{ s.label }}
        </button>
      </div>
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
        <div v-for="f in factList" :key="f.label" class="card fact">
          <span class="fact-value">{{ f.value }}</span>
          <span class="muted">{{ f.label }}</span>
          <span v-if="f.hint" class="faint small">{{ f.hint }}</span>
        </div>
      </div>

      <section v-if="flow" class="card card-body">
        <div class="row section-head">
          <h2>{{ flow.title }}</h2>
          <span class="spacer" />
          <button class="btn btn-sm" type="button" @click="exportChart(flow, 320)">Als Bild</button>
        </div>
        <ReportChart :spec="flow" :height="320" />
      </section>

      <div class="two">
        <section v-for="spec in [status, assignee]" :key="spec?.title" class="card card-body">
          <template v-if="spec">
            <div class="row section-head">
              <h2>{{ spec.title }}</h2>
              <span class="spacer" />
              <button class="btn btn-sm" type="button" @click="exportChart(spec, barChartHeight(spec.labels.length))">Als Bild</button>
            </div>
            <ReportChart v-if="spec.labels.length" :spec="spec" :height="barChartHeight(spec.labels.length)" />
            <div v-else class="faint">Keine offenen {{ noun }}.</div>
          </template>
        </section>
      </div>

      <div class="two">
        <section v-if="priorities" class="card card-body">
          <h2>Offene {{ noun }} nach Priorität</h2>
          <table class="table">
            <thead v-if="priorities.head.length > 2">
              <tr>
                <th v-for="(h, i) in priorities.head" :key="h" :class="{ num: i > 0 }">{{ i === 0 ? '' : h }}</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="row in priorities.rows" :key="row[0]">
                <td v-for="(cell, i) in row" :key="i" :class="{ num: i > 0 }">{{ cell }}</td>
              </tr>
            </tbody>
          </table>
        </section>
        <section v-if="channel" class="card card-body">
          <div class="row section-head">
            <h2>{{ channel.title }}</h2>
            <span class="spacer" />
            <button class="btn btn-sm" type="button" @click="exportChart(channel, barChartHeight(channel.labels.length))">Als Bild</button>
          </div>
          <ReportChart v-if="channel.labels.length" :spec="channel" :height="barChartHeight(channel.labels.length)" />
          <div v-else class="faint">Keine Meldungen im Zeitraum.</div>
        </section>
      </div>

      <section v-if="loadedScope === 'task'" class="card card-body">
        <h2>Überfällige Aufgaben <span class="faint small">offen, Fälligkeit vorbei, {{ report.overdue.total }} insgesamt</span></h2>
        <table v-if="report.overdue.items.length" class="table">
          <thead>
            <tr>
              <th>Nummer</th>
              <th>Titel</th>
              <th>Status</th>
              <th>Zuständig</th>
              <th>Fällig</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="i in report.overdue.items" :key="i.number">
              <td>
                <ItemLink :number="i.number" type="task" class="mono">{{ itemRef(i.number) }}</ItemLink>
              </td>
              <td class="title-cell">{{ i.title }}</td>
              <td>{{ i.status }}</td>
              <td>{{ i.assignee ?? '–' }}</td>
              <td class="overdue">{{ overdueText(i.dueDate) }}</td>
            </tr>
          </tbody>
        </table>
        <div v-else class="faint">Keine überfälligen Aufgaben.</div>
      </section>

      <div class="two">
        <section v-if="loadedScope === 'incident' && resolution" class="card card-body">
          <h2>Dauer bis «Gelöst» je Priorität <span class="faint small">im Zeitraum gelöst</span></h2>
          <table class="table">
            <thead>
              <tr>
                <th v-for="(h, i) in resolution.head" :key="h" :class="{ num: i > 0 }">{{ i === 0 ? '' : h }}</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="row in resolution.rows" :key="row[0]">
                <td v-for="(cell, i) in row" :key="i" :class="{ num: i > 0 }">{{ cell }}</td>
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
        <h2>Älteste offene {{ noun }} <span class="faint small">{{ oldestHint(report, loadedScope) }}</span></h2>
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
                <ItemLink :number="i.number" :type="i.type" class="mono">{{ itemRef(i.number) }}</ItemLink>
              </td>
              <td class="title-cell">{{ i.title }}</td>
              <td>{{ i.status ?? 'Eingang' }}</td>
              <td>{{ i.assignee ?? '–' }}</td>
              <td>{{ formatDate(i.createdAt) }} <span class="faint small">({{ daysSince(i.createdAt) }} Tage)</span></td>
            </tr>
          </tbody>
        </table>
        <div v-else class="faint">Keine {{ noun }}, die länger als 30 Tage offen sind.</div>
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
.page-head h1 {
  margin-right: 8px;
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
  grid-template-columns: repeat(auto-fit, minmax(170px, 1fr));
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
.overdue {
  color: var(--danger);
}
</style>
