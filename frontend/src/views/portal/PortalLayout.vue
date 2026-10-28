<script setup lang="ts">
import { ref } from 'vue';
import AppLogo from '../../components/AppLogo.vue';
import ImpersonationBanner from '../../components/ImpersonationBanner.vue';
import TestModeBanner from '../../components/TestModeBanner.vue';
import UserMenu from '../../components/UserMenu.vue';
import { useStickyTop } from '../../composables';
import { useSession } from '../../stores/session';
import { useToast } from '../../stores/toast';
import { THEMES } from '../../theme';
import type { Theme } from '../../types';

const session = useSession();
const toast = useToast();
const topBar = ref<HTMLElement | null>(null);
useStickyTop(topBar);

/** Farbschema im Benutzermenü (das Portal hat keine Seite «Einstellungen»), gespeichert im Konto */
async function setTheme(theme: Theme) {
  if (session.preferences.theme === theme) return;
  try {
    await session.savePreferences({ theme });
  } catch (err) {
    toast.error(err);
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
      <UserMenu>
        <div class="menu-theme">
          <span class="menu-theme-label faint">Darstellung</span>
          <div class="segmented" role="group" aria-label="Darstellung">
            <button
              v-for="o in THEMES"
              :key="o.value"
              type="button"
              :class="{ active: session.preferences.theme === o.value }"
              :aria-pressed="session.preferences.theme === o.value"
              @click="setTheme(o.value)"
            >
              {{ o.label }}
            </button>
          </div>
        </div>
      </UserMenu>
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
.menu-theme {
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 6px 8px 10px;
  margin-bottom: 4px;
  border-bottom: 1px solid var(--border);
}
.menu-theme-label {
  font-size: 12px;
}
.portal-page {
  max-width: 900px;
  margin: 0 auto;
  padding: 24px 16px 48px;
}
@media (max-width: 640px) {
  .portal-header {
    gap: 8px;
    padding: 0 12px;
  }
}
</style>
