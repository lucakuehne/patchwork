<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { useSession } from '../stores/session';
import type { Area } from '../types';
import AppLogo from './AppLogo.vue';
import UserMenu from './UserMenu.vue';

const session = useSession();
const route = useRoute();
const router = useRouter();

const search = ref(typeof route.query.q === 'string' ? route.query.q : '');

// Nur die Bereiche, die der Benutzer sieht (Bereiche je Rolle)
const tabs = computed(() =>
  [
    { area: 'inbox', to: '/inbox', label: 'Eingang', count: session.counts.inbox, prefix: '/inbox' },
    { area: 'incident', to: '/incidents', label: 'Störungen', count: session.counts.incidents, prefix: '/incidents' },
    { area: 'task', to: '/tasks', label: 'Aufgaben', count: session.counts.tasks, prefix: '/tasks' },
  ].filter((tab) => session.areas.includes(tab.area as Area)),
);

function submitSearch() {
  const q = search.value.trim();
  if (q) void router.push({ name: 'search', query: { q } });
}

let timer: number | undefined;
onMounted(() => {
  timer = window.setInterval(() => void session.refreshCounts(true).catch(() => undefined), 30000);
});
onBeforeUnmount(() => window.clearInterval(timer));
watch(
  () => route.fullPath,
  () => void session.refreshCounts().catch(() => undefined),
);
</script>

<template>
  <header class="header">
    <RouterLink :to="{ name: session.homeRoute }" class="brand">
      <AppLogo compact />
    </RouterLink>

    <nav class="tabs">
      <RouterLink
        v-for="tab in tabs"
        :key="tab.to"
        :to="tab.to"
        class="tab"
        :class="{ active: route.path.startsWith(tab.prefix) }"
      >
        {{ tab.label }}
        <span class="count" :class="{ zero: tab.count === 0 }">{{ tab.count }}</span>
      </RouterLink>
      <RouterLink v-if="session.isAdmin" to="/reports" class="tab" :class="{ active: route.path.startsWith('/reports') }">
        Auswertungen
      </RouterLink>
    </nav>

    <div class="spacer" />

    <form class="search" role="search" @submit.prevent="submitSearch">
      <input v-model="search" class="input" type="search" placeholder="Suchen (Text oder Nummer)" />
    </form>

    <UserMenu>
      <RouterLink to="/settings" class="menu-item">Einstellungen</RouterLink>
      <RouterLink v-if="session.isAdmin" to="/admin" class="menu-item">Verwaltung</RouterLink>
    </UserMenu>
  </header>
</template>

<style scoped>
/* Klebt zusammen mit den Hinweisbalken oben (Block «top-bar» in App.vue) */
.header {
  position: relative;
  display: flex;
  align-items: center;
  gap: 16px;
  height: 56px;
  padding: 0 20px;
  background: var(--surface);
  border-bottom: 1px solid var(--border);
}
.brand {
  display: flex;
  align-items: center;
  flex-shrink: 0;
}
.tabs {
  display: flex;
  gap: 2px;
  height: 100%;
}
.tab {
  display: flex;
  align-items: center;
  gap: 7px;
  padding: 0 12px;
  height: 100%;
  color: var(--text-muted);
  font-weight: 500;
  border-bottom: 2px solid transparent;
  text-decoration: none;
}
.tab:hover {
  color: var(--text);
  text-decoration: none;
}
.tab.active {
  color: var(--accent);
  border-bottom-color: var(--accent);
}
.count {
  min-width: 20px;
  height: 20px;
  padding: 0 6px;
  border-radius: 10px;
  background: var(--accent);
  color: #fff;
  font-size: 12px;
  font-weight: 600;
  display: inline-flex;
  align-items: center;
  justify-content: center;
}
.count.zero {
  background: var(--surface-2);
  color: var(--text-faint);
}
.search {
  width: 280px;
}
.tab {
  white-space: nowrap;
}
.tabs {
  min-width: 0;
  overflow-x: auto;
  scrollbar-width: none;
}
@media (max-width: 1000px) {
  .search {
    width: 160px;
  }
  .header :deep(.user-name) {
    display: none;
  }
}
@media (max-width: 760px) {
  .header {
    gap: 8px;
    padding: 0 12px;
  }
  .search {
    display: none;
  }
  .tab {
    padding: 0 8px;
  }
}
</style>
