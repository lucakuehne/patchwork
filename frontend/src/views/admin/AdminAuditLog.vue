<script setup lang="ts">
import { onMounted, ref, watch } from 'vue';
import { useRoute, useRouter, type LocationQuery } from 'vue-router';
import { api } from '../../api';
import ItemLink from '../../components/ItemLink.vue';
import { useDebounced } from '../../composables';
import { formatDateTime, itemRef } from '../../format';
import { useToast } from '../../stores/toast';
import type { AuditArea, AuditEntry } from '../../types';

/**
 * Aktionsprotokoll (Entscheid vom 03.11.2026): jede Änderung durch eine Person, An- und Abmeldungen, neueste zuoberst,
 * nur lesen. Filter nach Person, Bereich, Zeitraum und Suche (Nummer oder Text) stehen in der Adresse.
 */
const route = useRoute();
const router = useRouter();
const toast = useToast();

const AREAS: { key: AuditArea | ''; label: string }[] = [
  { key: '', label: 'Alle' },
  { key: 'items', label: 'Vorgänge' },
  { key: 'portal', label: 'Portal' },
  { key: 'admin', label: 'Verwaltung' },
  { key: 'account', label: 'Anmeldung und Konto' },
];
const AREA_LABELS = Object.fromEntries(AREAS.map((a) => [a.key, a.label])) as Record<AuditArea, string>;
const PAGE = 100;
const DATE = /^\d{4}-\d{2}-\d{2}$/;

interface Filters {
  user: string;
  area: AuditArea | '';
  from: string;
  to: string;
  q: string;
}

const text = (value: unknown) => (typeof value === 'string' ? value : '');
function fromQuery(query: LocationQuery): Filters {
  const area = text(query.area);
  return {
    user: text(query.user),
    area: AREAS.some((a) => a.key === area) ? (area as AuditArea) : '',
    from: DATE.test(text(query.from)) ? text(query.from) : '',
    to: DATE.test(text(query.to)) ? text(query.to) : '',
    q: text(query.q),
  };
}

const initial = fromQuery(route.query);
const user = ref(initial.user);
const area = ref<AuditArea | ''>(initial.area);
const from = ref(initial.from);
const to = ref(initial.to);
const query = ref(initial.q);
const debouncedQuery = useDebounced(query);

const people = ref<{ id: string; name: string; email: string }[]>([]);
const entries = ref<AuditEntry[]>([]);
const more = ref(false);
const loading = ref(true);

const current = (): Filters => ({ user: user.value, area: area.value, from: from.value, to: to.value, q: debouncedQuery.value.trim() });

async function load(append = false) {
  loading.value = true;
  const f = current();
  const params = new URLSearchParams({ limit: String(PAGE), offset: String(append ? entries.value.length : 0) });
  for (const key of ['user', 'area', 'from', 'to', 'q'] as const) if (f[key]) params.set(key, f[key]);
  try {
    const data = await api.get<{ entries: AuditEntry[]; more: boolean }>(`/admin/audit-log?${params}`);
    entries.value = append ? [...entries.value, ...data.entries] : data.entries;
    more.value = data.more;
  } catch (err) {
    toast.error(err);
  } finally {
    loading.value = false;
  }
}

onMounted(async () => {
  void load();
  try {
    people.value = await api.get('/admin/audit-log/people');
  } catch (err) {
    toast.error(err);
  }
});

/** Gesetzte Filter für die Adresse, z.B. { area: 'admin', q: 'PW-12' } */
const asQuery = (f: Filters) => Object.fromEntries(Object.entries(f).filter(([, v]) => v));
const same = (a: Filters, b: Filters) => JSON.stringify(asQuery(a)) === JSON.stringify(asQuery(b));

// Filter in die Adresse (ohne neuen Eintrag im Verlauf) und neu laden
watch([user, area, from, to, debouncedQuery], () => {
  if (!same(current(), fromQuery(route.query))) void router.replace({ query: asQuery(current()) });
  void load();
});

// Adresse von aussen geändert (z.B. Klick auf «Aktionsprotokoll» in der Navigation): Filter übernehmen
watch(
  () => route.query,
  (q) => {
    const f = fromQuery(q);
    if (route.name !== 'admin-audit-log' || same(f, current())) return;
    user.value = f.user;
    area.value = f.area;
    from.value = f.from;
    to.value = f.to;
    query.value = debouncedQuery.value = f.q;
  },
);

const person = (e: AuditEntry) => (e.impersonatorName ? `${e.userName} (durch ${e.impersonatorName})` : e.userName);
</script>

<template>
  <div class="stack">
    <h1>Aktionsprotokoll</h1>
    <p class="muted" style="margin: 0">
      Jede Änderung durch eine Person in Patchwork und im Portal, dazu An- und Abmeldungen. Ohne automatische Aktionen (Regeln,
      Mailabruf). Einträge bleiben sechs Monate.
    </p>
    <div class="row filters">
      <div class="segmented">
        <button v-for="a in AREAS" :key="a.key" type="button" :class="{ active: area === a.key }" @click="area = a.key">
          {{ a.label }}
        </button>
      </div>
    </div>
    <div class="row filters">
      <select v-model="user" class="select person" aria-label="Person">
        <option value="">Alle Personen</option>
        <option v-for="p in people" :key="p.id" :value="p.id">{{ p.name }}</option>
      </select>
      <label class="date-field">Von <input v-model="from" class="input date" type="date" /></label>
      <label class="date-field">Bis <input v-model="to" class="input date" type="date" /></label>
      <input v-model="query" class="input search" type="search" placeholder="Suchen (Nummer oder Text)" aria-label="Suchen" />
    </div>
    <div class="card table-wrap">
      <table class="table">
        <thead>
          <tr>
            <th>Zeit</th>
            <th>Person</th>
            <th>Bereich</th>
            <th>Aktion</th>
            <th>Objekt</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="e in entries" :key="e.id">
            <td class="nowrap muted">{{ formatDateTime(e.createdAt) }}</td>
            <td>{{ person(e) }}</td>
            <td class="nowrap"><span class="badge">{{ AREA_LABELS[e.area] }}</span></td>
            <td>{{ e.action }}</td>
            <td class="target">
              <template v-if="e.item">
                <ItemLink :item-key="e.item" :type="e.item.type" :title="e.item.title" class="mono">{{ itemRef(e.item) }}</ItemLink>
                {{ e.item.title }}
              </template>
              <span v-else-if="e.target">{{ e.target }}</span>
              <span v-else class="faint">–</span>
            </td>
          </tr>
        </tbody>
      </table>
      <div v-if="!loading && !entries.length" class="empty">Keine Einträge.</div>
    </div>
    <div v-if="more" class="row">
      <button class="btn" type="button" :disabled="loading" @click="load(true)">Mehr laden</button>
    </div>
  </div>
</template>

<style scoped>
.filters {
  flex-wrap: wrap;
  gap: 8px 12px;
}
.person {
  width: 220px;
}
.date-field {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  color: var(--text-muted);
}
.date {
  width: 150px;
}
.search {
  width: 240px;
}
.target {
  overflow-wrap: anywhere;
}
</style>
