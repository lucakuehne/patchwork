<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue';
import { api } from '../../api';
import ItemLink from '../../components/ItemLink.vue';
import { formatDateTime, itemRef, TYPE_LABELS } from '../../format';
import { formatDuration, remainingMs } from '../../import-estimate';
import { useConfirm } from '../../stores/confirm';
import { useSession } from '../../stores/session';
import { useToast } from '../../stores/toast';
import type { HelpSpotCopy, HelpSpotImportRun, HelpSpotView, ItemType } from '../../types';

/**
 * Import aus HelpSpot (Entscheid vom 29.10.2026): Tickets werden Vorgänge HS-<Nummer> mit Verlauf und Anhängen. Zuerst
 * Verbindung und Übersicht, dann die Zuordnungen von Typ, Status und Meldeweg, dann der Import; er lässt sich jederzeit
 * wiederholen und holt nur, was sich in HelpSpot geändert hat. Ein Lauf nimmt nur geschlossene Tickets oder, am Stichtag,
 * auch offene (Entscheid vom 30.10.2026).
 */
const session = useSession();
const toast = useToast();
const confirm = useConfirm();

const view = ref<HelpSpotView | null>(null);
const url = ref('');
const apiKey = ref('');
const types = ref<Record<string, ItemType>>({});
const statuses = ref<Record<string, string | null>>({});
const channels = ref<Record<string, string | null>>({});
const copies = ref<HelpSpotCopy[]>([]);
/** Je Paar (ID der Kopie): welcher Vorgang bleibt, oder nicht bereinigen */
const choices = ref<Record<string, 'copy' | 'original' | 'skip'>>({});
const busy = ref(false);
/** Umfang des nächsten Laufs: nur geschlossene Tickets oder auch offene (Stichtag) */
const includeOpen = ref(false);
let pollTimer: number | undefined;

const running = computed(() => (view.value?.runs[0]?.status === 'running' ? view.value.runs[0] : null));
const percent = (run: HelpSpotImportRun) => (run.total ? Math.round((run.processed / run.total) * 100) : 0);
function apply(next: HelpSpotView) {
  view.value = next;
  url.value = next.url;
  types.value = { ...next.mappings.types };
  statuses.value = { ...next.mappings.statuses };
  channels.value = { ...next.mappings.channels };
}

async function load() {
  try {
    const [next, list] = await Promise.all([api.get<HelpSpotView>('/admin/helpspot'), api.get<HelpSpotCopy[]>('/admin/helpspot/copies')]);
    apply(next);
    setCopies(list);
    schedulePoll();
  } catch (err) {
    toast.error(err);
  }
}
onMounted(load);
onBeforeUnmount(() => window.clearTimeout(pollTimer));

/** Solange ein Import läuft, alle 3 Sekunden den Fortschritt holen */
function schedulePoll() {
  window.clearTimeout(pollTimer);
  if (!running.value) return;
  pollTimer = window.setTimeout(async () => {
    try {
      const next = await api.get<HelpSpotView>('/admin/helpspot', { background: true });
      view.value = next;
      if (next.runs[0]?.status !== 'running') {
        setCopies(await api.get<HelpSpotCopy[]>('/admin/helpspot/copies'));
        toast.success('Import aus HelpSpot beendet');
      }
    } catch {
      // Beim nächsten Mal wieder
    }
    schedulePoll();
  }, 3000);
}

const payload = () => ({
  url: url.value,
  ...(apiKey.value ? { apiKey: apiKey.value } : {}),
  types: types.value,
  statuses: Object.fromEntries(Object.entries(statuses.value).filter(([, id]) => !!id)),
  channels: channels.value,
});

async function run(action: () => Promise<HelpSpotView | void>, success?: string) {
  busy.value = true;
  try {
    const next = await action();
    if (next) apply(next);
    apiKey.value = '';
    if (success) toast.success(success);
  } catch (err) {
    toast.error(err);
  } finally {
    busy.value = false;
  }
}

const save = () => run(() => api.put<HelpSpotView>('/admin/helpspot', payload()), 'Gespeichert');
/** Speichern, dann Verbindung prüfen und die Werte in HelpSpot zählen */
const analyze = () =>
  run(async () => {
    await api.put<HelpSpotView>('/admin/helpspot', payload());
    return api.post<HelpSpotView>('/admin/helpspot/analysis');
  }, 'Verbindung in Ordnung, Übersicht geladen');

async function startImport() {
  if (includeOpen.value) {
    const ok = await confirm.ask({
      title: 'Mit offenen Tickets importieren',
      message:
        'Die offenen Tickets aus HelpSpot werden als offene Vorgänge übernommen, mit Status nach Zuordnung und den Zuständigen. ' +
        'Das ist für den Stichtag gedacht, wenn HelpSpot keine Mails mehr abholt.',
      confirmLabel: 'Importieren',
    });
    if (!ok) return;
  }
  await run(async () => {
    await api.put<HelpSpotView>('/admin/helpspot', payload());
    await api.post('/admin/helpspot/import', { includeOpen: includeOpen.value });
    return api.get<HelpSpotView>('/admin/helpspot');
  }, 'Import gestartet');
  schedulePoll();
}

/** Paare neu setzen, die Wahl je Paar nach dem Vorschlag */
function setCopies(list: HelpSpotCopy[]) {
  copies.value = list;
  choices.value = Object.fromEntries(list.map((c) => [c.copy.id, c.suggestion.keep]));
}

const COPY_REASONS: Record<NonNullable<HelpSpotCopy['suggestion']['reason']>, string> = {
  task: 'Aufgabe in Patchwork',
  staffEntries: 'Antworten oder Notizen der IT',
};
const copyState = (c: HelpSpotCopy['copy']) =>
  c.discarded ? 'verworfen' : c.type ? `${TYPE_LABELS[c.type]} · ${c.status?.label ?? ''}` : 'Eingang';

async function resolveCopies() {
  const picked = copies.value.filter((c) => choices.value[c.copy.id] !== 'skip');
  const keepCopy = picked.filter((c) => choices.value[c.copy.id] === 'copy').length;
  const skipped = copies.value.length - picked.length;
  const ok = await confirm.ask({
    title: 'Kopien bereinigen',
    message:
      `${picked.length - keepCopy} Vorgänge aus Patchwork und ${keepCopy} aus HelpSpot werden geschlossen (im Eingang verworfen) ` +
      `und als Duplikat mit dem bleibenden verknüpft.${skipped ? ` ${skipped} Paare bleiben unverändert.` : ''} Es gehen keine Mails hinaus.`,
    confirmLabel: 'Bereinigen',
  });
  if (!ok) return;
  await run(async () => {
    const result = await api.post<{ resolved: number }>('/admin/helpspot/copies/resolve', {
      choices: picked.map((c) => ({ copyId: c.copy.id, keep: choices.value[c.copy.id] })),
    });
    setCopies(await api.get<HelpSpotCopy[]>('/admin/helpspot/copies'));
    toast.success(`${result.resolved} Paare bereinigt`);
  });
}

// Zuordnung der Status: je Typ, der in Patchwork vorkommt, jeder Status aus HelpSpot mit offen/geschlossen
const usedTypes = computed(() => [...new Set(Object.values(types.value))].sort() as ItemType[]);
const statusRows = computed(() =>
  usedTypes.value.flatMap((type) =>
    (view.value?.analysis?.statuses ?? []).map((s) => ({ type, ...s, key: `${type}|${s.status}|${s.open ? 'open' : 'closed'}` })),
  ),
);
const statusOptions = (type: ItemType, open: boolean) => session.statusesOf(type).filter((s) => s.closed === !open);
const runLabel: Record<HelpSpotImportRun['status'], string> = { running: 'läuft', done: 'fertig', failed: 'abgebrochen' };
const scopeLabel = (r: HelpSpotImportRun) => (r.includeOpen ? 'geschlossene und offene' : 'nur geschlossene');
const runResult = (r: HelpSpotImportRun) =>
  [
    `${r.processed} von ${r.total} · ${r.created} neu`,
    `${r.updated} ergänzt`,
    `${r.skipped} übersprungen`,
    ...(r.includeOpen ? [] : [`${r.skippedOpen} offene ausgelassen`]),
    `${r.failed} Fehler`,
  ].join(', ');
</script>

<template>
  <div class="stack">
    <h1>HelpSpot-Import</h1>
    <p class="faint intro">
      Übernimmt die Tickets aus HelpSpot als Vorgänge HS-&lt;Nummer&gt;, mit Verlauf, internen Notizen und Anhängen, ohne Papierkorb und
      Spam. Dabei lösen keine Regeln und keine Mails aus; Auswertungen und Portal zeigen die Vorgänge nicht. Jeder weitere Import holt nur,
      was sich in HelpSpot seither geändert hat.
    </p>

    <div v-if="view" class="card card-body stack">
      <h2>Verbindung</h2>
      <div class="grid-2">
        <div class="field">
          <label for="hs-url">Adresse von HelpSpot</label>
          <input id="hs-url" v-model="url" class="input" placeholder="https://helpspot.firma.local" />
        </div>
        <div class="field">
          <label for="hs-key">API-Schlüssel</label>
          <input
            id="hs-key"
            v-model="apiKey"
            class="input"
            type="password"
            autocomplete="off"
            :placeholder="view.hasApiKey ? 'gespeichert, leer lassen zum Behalten' : 'Token eines Kontos, das alle Tickets lesen darf'"
          />
        </div>
      </div>
      <span class="hint faint">
        In HelpSpot unter Admin → Settings → Web Services API die Private API einschalten; das Token steht im Profil des Kontos. Der
        Schlüssel wird verschlüsselt gespeichert.
      </span>
      <div class="row">
        <button class="btn" type="button" :disabled="busy" @click="save">Speichern</button>
        <button class="btn btn-primary" type="button" :disabled="busy || !url" @click="analyze">Verbindung prüfen und Werte laden</button>
      </div>
    </div>

    <div v-if="view?.analysis" class="card card-body stack">
      <h2>Zuordnungen</h2>
      <span class="faint">
        {{ view.analysis.total }} Tickets in HelpSpot, Stand {{ formatDateTime(view.analysis.at) }}. Vorgeschlagen ist, was noch nicht
        festgelegt ist.
      </span>

      <h3>Typ (Feld «Type»)</h3>
      <table class="table mapping">
        <tbody>
          <tr v-for="t in view.analysis.types" :key="t.value" :data-hs-type="t.value">
            <td>{{ t.value || '(leer)' }}</td>
            <td class="faint num">{{ t.count }}</td>
            <td>
              <select v-model="types[t.value]" class="select" :aria-label="`Typ für ${t.value || 'leer'}`">
                <option value="incident">{{ TYPE_LABELS.incident }}</option>
                <option value="task">{{ TYPE_LABELS.task }}</option>
              </select>
            </td>
          </tr>
        </tbody>
      </table>

      <h3>Status</h3>
      <table class="table mapping">
        <tbody>
          <tr v-for="s in statusRows" :key="s.key" :data-hs-status="s.key">
            <td>
              {{ s.status }} <span class="faint">({{ s.open ? 'offen' : 'geschlossen' }}) · {{ TYPE_LABELS[s.type] }}</span>
            </td>
            <td class="faint num">{{ s.count }}</td>
            <td>
              <select v-model="statuses[s.key]" class="select" :aria-label="`Status für ${s.status} (${s.open ? 'offen' : 'geschlossen'})`">
                <option v-for="o in statusOptions(s.type, s.open)" :key="o.id" :value="o.id">{{ o.label }}</option>
              </select>
            </td>
          </tr>
        </tbody>
      </table>
      <span class="hint faint">Geschlossene Tickets lassen sich nur abgeschlossenen Status zuordnen, offene nur offenen.</span>

      <h3>Meldeweg («Eröffnet über»)</h3>
      <table class="table mapping">
        <tbody>
          <tr v-for="c in view.analysis.openedVia" :key="c.value" :data-hs-channel="c.value">
            <td>{{ c.value || '(leer)' }}</td>
            <td class="faint num">{{ c.count }}</td>
            <td>
              <select v-model="channels[c.value]" class="select" :aria-label="`Meldeweg für ${c.value || 'leer'}`">
                <option :value="null">ohne Meldeweg</option>
                <option v-for="ch in session.channels" :key="ch.id" :value="ch.id">{{ ch.label }}</option>
              </select>
            </td>
          </tr>
        </tbody>
      </table>
      <div><button class="btn" type="button" :disabled="busy" @click="save">Zuordnungen speichern</button></div>
    </div>

    <div v-if="view" class="card card-body stack">
      <h2>Import</h2>
      <span>Bereits übernommen: {{ view.imported }} Tickets.</span>
      <div v-if="running" class="progress" role="status">
        <div class="bar"><div class="fill" :style="{ width: `${percent(running)}%` }" /></div>
        <span class="faint">
          {{ runResult(running) }}
        </span>
        <!-- Hochrechnung: rechnet bei jedem Abholen des Fortschritts (alle 3 Sekunden) neu -->
        <span v-if="remainingMs(running) !== null" class="estimate">Voraussichtlich noch {{ formatDuration(remainingMs(running)!) }}</span>
      </div>
      <div class="segmented scope" role="group" aria-label="Umfang des Imports">
        <button type="button" :class="{ active: !includeOpen }" :aria-pressed="!includeOpen" @click="includeOpen = false">Nur geschlossene Tickets</button>
        <button type="button" :class="{ active: includeOpen }" :aria-pressed="includeOpen" @click="includeOpen = true">Geschlossene und offene Tickets</button>
      </div>
      <span class="hint faint">
        <template v-if="includeOpen">
          Für den Stichtag: übernimmt auch alle offenen Tickets, auch die seit dem letzten Import unveränderten, als offene Vorgänge.
        </template>
        <template v-else>
          Offene Tickets lässt der Import aus; ein früher übernommenes Ticket, das in HelpSpot wieder offen ist, bleibt auf dem Stand
          des letzten Imports. Vorher den Mail-Abruf unter Postfächer ausschalten.
        </template>
      </span>
      <div class="row">
        <button class="btn btn-primary" type="button" :disabled="busy || !!running || !view.hasApiKey" @click="startImport">Importieren</button>
        <span class="faint">Läuft im Hintergrund; HelpSpot erlaubt etwa eine Anfrage pro Sekunde, der erste Import dauert einige Stunden.</span>
      </div>
      <table v-if="view.runs.length" class="table runs">
        <thead>
          <tr>
            <th>Beginn</th>
            <th>Umfang</th>
            <th>Status</th>
            <th>Ergebnis</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="r in view.runs" :key="r.id">
            <td class="nowrap">{{ formatDateTime(r.startedAt) }}</td>
            <td>{{ scopeLabel(r) }}</td>
            <td>{{ runLabel[r.status] }}</td>
            <td>
              {{ runResult(r) }}
              <div v-if="r.error" class="error-text">{{ r.error }}</div>
              <details v-if="r.errors.length" class="small">
                <summary>Fehler einzelner Tickets</summary>
                <div v-for="e in r.errors" :key="e.number">HelpSpot {{ e.number }}: {{ e.message }}</div>
              </details>
            </td>
          </tr>
        </tbody>
      </table>
    </div>

    <div v-if="view" class="card card-body stack">
      <h2>Kopien aus der Parallelphase</h2>
      <span class="faint">
        Vorgänge, die Patchwork aus derselben ersten Mail angelegt hat wie HelpSpot sein Ticket. Beim Umstieg wählst du je Paar, welcher
        bleibt; der andere wird ohne Mails geschlossen (im Eingang verworfen) und als Duplikat mit dem bleibenden verknüpft. Vorgeschlagen
        bleibt der Vorgang aus Patchwork, wenn er eine Aufgabe ist oder Antworten bzw. Notizen der IT hat, sonst der aus HelpSpot.
      </span>
      <table v-if="copies.length" class="table copies">
        <thead>
          <tr>
            <th>Patchwork</th>
            <th>HelpSpot</th>
            <th>Bleibt</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="c in copies" :key="c.copy.id" :data-copy="itemRef(c.copy)">
            <td>
              <ItemLink :item-key="c.copy" :type="c.copy.type" class="mono">{{ itemRef(c.copy) }}</ItemLink> {{ c.copy.title }}
              <div class="faint small">
                {{ copyState(c.copy) }}<template v-if="c.suggestion.reason"> · {{ COPY_REASONS[c.suggestion.reason] }}</template>
              </div>
            </td>
            <td>
              <ItemLink :item-key="c.original" :type="c.original.type" class="mono">{{ itemRef(c.original) }}</ItemLink> {{ c.original.title }}
              <div class="faint small">
                {{ c.original.type ? TYPE_LABELS[c.original.type] : '' }} · {{ c.original.status?.label ?? '' }}
              </div>
            </td>
            <td>
              <select v-model="choices[c.copy.id]" class="select" :aria-label="`Was bleibt bei ${itemRef(c.copy)}`">
                <option value="original">{{ itemRef(c.original) }} bleibt</option>
                <option value="copy">{{ itemRef(c.copy) }} bleibt</option>
                <option value="skip">nicht bereinigen</option>
              </select>
            </td>
          </tr>
        </tbody>
      </table>
      <span v-else class="faint">Keine Kopien gefunden.</span>
      <div v-if="copies.length">
        <button class="btn" type="button" :disabled="busy" @click="resolveCopies">Kopien bereinigen</button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.intro {
  margin: 0;
}
h3 {
  margin: 8px 0 0;
  font-size: 15px;
}
.mapping .select {
  max-width: 280px;
}
.num {
  width: 70px;
  text-align: right;
}
.progress {
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.bar {
  height: 8px;
  border-radius: 999px;
  background: var(--surface-2);
  overflow: hidden;
}
.fill {
  height: 100%;
  background: var(--accent);
  transition: width 0.4s;
}
.estimate {
  font-size: 13px;
}
.error-text {
  color: var(--danger);
}
.small {
  font-size: 12px;
}
.nowrap {
  white-space: nowrap;
}
.copies .select {
  min-width: 170px;
}
</style>
