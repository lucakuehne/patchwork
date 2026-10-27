<script setup lang="ts">
import { ref } from 'vue';
import { useRouter } from 'vue-router';
import AppLogo from '../../components/AppLogo.vue';
import ImpersonationBanner from '../../components/ImpersonationBanner.vue';
import TestModeBanner from '../../components/TestModeBanner.vue';
import { useStickyTop } from '../../composables';
import { useSession } from '../../stores/session';

const session = useSession();
const router = useRouter();
const topBar = ref<HTMLElement | null>(null);
useStickyTop(topBar);

async function logout() {
  try {
    await session.logout();
  } finally {
    await router.push({ name: 'login' });
  }
}
</script>

<template>
  <!-- Hinweisbalken und Kopfzeile kleben gemeinsam oben -->
  <div ref="topBar" class="top-bar">
    <!-- Hat der Benutzer, als der ein Admin arbeitet, inzwischen die Rolle Standard, führt der Weg zurück übers Portal -->
    <ImpersonationBanner />
    <TestModeBanner />
    <header class="portal-header">
      <RouterLink to="/portal" class="brand">
        <AppLogo compact />
      </RouterLink>
      <nav class="nav">
        <RouterLink to="/portal" class="nav-link" exact-active-class="active">Meine Vorgänge</RouterLink>
        <RouterLink to="/portal/neu" class="nav-link" active-class="active">Neue Meldung</RouterLink>
      </nav>
      <div class="spacer" />
      <span class="user muted">{{ session.user?.name }}</span>
      <button class="btn btn-ghost btn-sm" type="button" @click="logout">Abmelden</button>
    </header>
  </div>
  <div class="portal-page">
    <RouterView />
  </div>
</template>

<style scoped>
.top-bar {
  position: sticky;
  top: 0;
  z-index: 50;
}
/* Bei wenig Höhe (z.B. Handy quer) würden die Balken zu viel verdecken */
@media (max-height: 500px) {
  .top-bar {
    position: static;
  }
}
.portal-header {
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
.nav {
  display: flex;
  gap: 4px;
}
.nav-link {
  padding: 6px 10px;
  border-radius: var(--radius-sm);
  color: var(--text-muted);
  font-weight: 500;
  text-decoration: none;
  white-space: nowrap;
}
.nav-link:hover {
  background: var(--surface-hover);
  text-decoration: none;
}
.nav-link.active {
  background: var(--accent-soft);
  color: var(--accent);
}
.portal-page {
  max-width: 900px;
  margin: 0 auto;
  padding: 24px 16px 48px;
}
@media (max-width: 640px) {
  .user {
    display: none;
  }
  .portal-header {
    gap: 8px;
    padding: 0 12px;
  }
}
</style>
