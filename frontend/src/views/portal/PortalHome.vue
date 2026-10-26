<script setup lang="ts">
import { ref, watch } from 'vue';
import { api } from '../../api';
import { formatDate, itemRef } from '../../format';
import { useToast } from '../../stores/toast';
import type { PortalItemSummary } from '../../types';
import PortalStatusBadge from './PortalStatusBadge.vue';

const toast = useToast();
const state = ref<'open' | 'closed'>('open');
const items = ref<PortalItemSummary[]>([]);
const loading = ref(true);

async function load() {
  loading.value = true;
  try {
    items.value = await api.get<PortalItemSummary[]>(`/portal/items?state=${state.value}`);
  } catch (err) {
    toast.error(err);
  } finally {
    loading.value = false;
  }
}
watch(state, load, { immediate: true });
</script>

<template>
  <div class="stack">
    <div class="row wrap">
      <h1>Meine Vorgänge</h1>
      <div class="segmented">
        <button type="button" :class="{ active: state === 'open' }" @click="state = 'open'">Offen</button>
        <button type="button" :class="{ active: state === 'closed' }" @click="state = 'closed'">Abgeschlossen</button>
      </div>
      <div class="spacer" />
      <RouterLink to="/portal/neu" class="btn btn-primary">+ Neue Meldung</RouterLink>
    </div>

    <div v-if="!loading && items.length === 0" class="card empty">
      <template v-if="state === 'open'">
        Du hast keine offenen Meldungen.
        <div style="margin-top: 12px"><RouterLink to="/portal/neu" class="btn">Etwas melden</RouterLink></div>
      </template>
      <template v-else>Keine abgeschlossenen Vorgänge.</template>
    </div>

    <RouterLink v-for="item in items" :key="item.number" :to="`/portal/v/${item.number}`" class="card item-card">
      <div class="row">
        <span class="mono muted small">{{ itemRef(item.number) }}</span>
        <PortalStatusBadge :status="item.status" />
        <span class="spacer" />
        <span class="faint small">
          {{ state === 'open' ? `Aktualisiert ${formatDate(item.updatedAt)}` : `Abgeschlossen ${formatDate(item.closedAt)}` }}
        </span>
      </div>
      <div class="title">{{ item.title }}</div>
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
