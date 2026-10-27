<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { initials } from '../format';
import { useSession } from '../stores/session';
import type { Area } from '../types';

const session = useSession();
const route = useRoute();
const router = useRouter();

const search = ref(typeof route.query.q === 'string' ? route.query.q : '');
const menuOpen = ref(false);

// Nur die Bereiche, die der Benutzer sieht (Bereiche je Rolle)
const tabs = computed(() =>
  [
    { area: 'inbox', to: '/eingang', label: 'Eingang', count: session.counts.inbox, prefix: '/eingang' },
    { area: 'incident', to: '/stoerungen', label: 'Störungen', count: session.counts.incidents, prefix: '/stoerungen' },
    { area: 'task', to: '/aufgaben', label: 'Aufgaben', count: session.counts.tasks, prefix: '/aufgaben' },
  ].filter((tab) => session.areas.includes(tab.area as Area)),
);

function submitSearch() {
  const q = search.value.trim();
  if (q) void router.push({ name: 'search', query: { q } });
}

async function logout() {
  menuOpen.value = false;
  try {
    await session.logout();
  } finally {
    await router.push({ name: 'login' });
  }
}

let timer: number | undefined;
onMounted(() => {
  timer = window.setInterval(() => void session.refreshCounts(true).catch(() => undefined), 30000);
});
onBeforeUnmount(() => window.clearInterval(timer));
watch(
  () => route.fullPath,
  () => {
    menuOpen.value = false;
    void session.refreshCounts().catch(() => undefined);
  },
);

function closeMenu(e: MouseEvent) {
  if (!(e.target as HTMLElement).closest('.user-menu')) menuOpen.value = false;
}
onMounted(() => document.addEventListener('click', closeMenu));
onBeforeUnmount(() => document.removeEventListener('click', closeMenu));
</script>

<template>
  <header class="header">
    <RouterLink :to="{ name: session.homeRoute }" class="brand">
      <img v-if="session.logoUrl" :src="session.logoUrl" alt="" class="logo" />
      <span>{{ session.appName }}</span>
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
      <RouterLink v-if="session.isAdmin" to="/auswertungen" class="tab" :class="{ active: route.path.startsWith('/auswertungen') }">
        Auswertungen
      </RouterLink>
    </nav>

    <div class="spacer" />

    <form class="search" role="search" @submit.prevent="submitSearch">
      <input v-model="search" class="input" type="search" placeholder="Suchen (Text oder PW-Nummer)" />
    </form>

    <div class="user-menu">
      <button class="btn btn-ghost user-btn" type="button" @click="menuOpen = !menuOpen">
        <span class="avatar">{{ initials(session.user?.name ?? '') }}</span>
        <span class="user-name">{{ session.user?.name }}</span>
      </button>
      <div v-if="menuOpen" class="menu card">
        <div class="menu-head">
          <div>{{ session.user?.name }}</div>
          <div class="faint">{{ session.user?.email }}</div>
        </div>
        <RouterLink to="/einstellungen" class="menu-item">Einstellungen</RouterLink>
        <RouterLink v-if="session.isAdmin" to="/admin" class="menu-item">Verwaltung</RouterLink>
        <button class="menu-item" type="button" @click="logout">Abmelden</button>
      </div>
    </div>
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
  gap: 8px;
  font-weight: 700;
  font-size: 16px;
  color: var(--text);
  text-decoration: none;
}
.logo {
  height: 28px;
  max-width: 120px;
  object-fit: contain;
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
.user-menu {
  position: relative;
}
.user-btn {
  padding: 0 6px;
}
.menu {
  position: absolute;
  right: 0;
  top: 40px;
  min-width: 220px;
  padding: 6px;
  display: flex;
  flex-direction: column;
  box-shadow: var(--shadow-lg);
}
.menu-head {
  padding: 6px 8px 8px;
  border-bottom: 1px solid var(--border);
  margin-bottom: 4px;
}
.menu-item {
  padding: 7px 8px;
  border-radius: var(--radius-sm);
  background: none;
  border: none;
  text-align: left;
  font: inherit;
  color: var(--text);
  cursor: pointer;
  text-decoration: none;
}
.menu-item:hover {
  background: var(--surface-hover);
  text-decoration: none;
}
.brand,
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
  .user-name {
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
@media (max-width: 560px) {
  .brand span {
    display: none;
  }
}
</style>
