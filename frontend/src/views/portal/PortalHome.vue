<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { api } from '../../api';
import { formatDate, itemRef } from '../../format';
import { useToast } from '../../stores/toast';
import type { PortalItemSummary } from '../../types';
import PortalStatusBadge from './PortalStatusBadge.vue';

type View = 'open' | 'closed' | 'participating';

const toast = useToast();
const route = useRoute();
const router = useRouter();
// Ansicht in der Adresse (?view=closed bzw. ?view=participating), damit «Zurück» aus einer Meldung wieder hierher führt
const view = computed<View>(() => {
  const v = route.query.view;
  return v === 'closed' || v === 'participating' ? v : 'open';
});
const items = ref<PortalItemSummary[]>([]);
/** Meldungen anderer, an denen man beteiligt ist; die Ansicht «Beteiligt» erscheint nur, wenn es welche gibt */
const participating = ref<PortalItemSummary[]>([]);
const loading = ref(true);

function show(next: View) {
  void router.replace({ query: next === 'open' ? {} : { view: next } });
}

async function load() {
  loading.value = true;
  try {
    const [own, others] = await Promise.all([
      view.value === 'participating' ? null : api.get<PortalItemSummary[]>(`/portal/items?state=${view.value}`),
      api.get<PortalItemSummary[]>('/portal/participating'),
    ]);
    participating.value = others;
    items.value = own ?? others;
  } catch (err) {
    toast.error(err);
  } finally {
    loading.value = false;
  }
}
watch(view, load, { immediate: true });

const dateText = (item: PortalItemSummary) =>
  item.status.closed && item.closedAt ? `Abgeschlossen ${formatDate(item.closedAt)}` : `Aktualisiert ${formatDate(item.updatedAt)}`;
</script>

<template>
  <div class="stack">
    <div class="row wrap">
      <h1>Meine Vorgänge</h1>
      <div class="segmented">
        <button type="button" :class="{ active: view === 'open' }" @click="show('open')">Offen</button>
        <button type="button" :class="{ active: view === 'closed' }" @click="show('closed')">Abgeschlossen</button>
        <button
          v-if="participating.length || view === 'participating'"
          type="button"
          :class="{ active: view === 'participating' }"
          title="Meldungen anderer, bei denen du beteiligt bist (z.B. in CC)"
          @click="show('participating')"
        >
          Beteiligt
        </button>
      </div>
      <div class="spacer" />
      <RouterLink to="/portal/new" class="btn btn-primary">+ Neue Meldung</RouterLink>
    </div>

    <div v-if="!loading && items.length === 0" class="card empty">
      <template v-if="view === 'open'">
        Du hast keine offenen Meldungen.
        <div style="margin-top: 12px"><RouterLink to="/portal/new" class="btn">Etwas melden</RouterLink></div>
      </template>
      <template v-else-if="view === 'closed'">Keine abgeschlossenen Vorgänge.</template>
      <template v-else>Du bist an keiner Meldung beteiligt.</template>
    </div>

    <RouterLink v-for="item in items" :key="itemRef(item)" :to="`/portal/items/${itemRef(item)}`" class="card item-card">
      <div class="row">
        <span class="mono muted small">{{ itemRef(item) }}</span>
        <PortalStatusBadge :status="item.status" />
        <span class="spacer" />
        <span class="faint small">{{ dateText(item) }}</span>
      </div>
      <div class="title">{{ item.title }}</div>
      <div v-if="view === 'participating'" class="muted small">Gemeldet von {{ item.reporter ?? 'unbekannt' }}</div>
    </RouterLink>
  </div>
</template>

<style scoped>
.wrap {
  flex-wrap: wrap;
}
.item-card {
  display: flex;
  flex-direction: column;
  gap: 4px;
  padding: 12px 14px;
  color: var(--text);
  text-decoration: none;
}
.item-card:hover {
  border-color: var(--border-strong);
  text-decoration: none;
}
.title {
  font-weight: 500;
  overflow-wrap: anywhere;
}
.small {
  font-size: 12px;
}
</style>
