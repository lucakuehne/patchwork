<script setup lang="ts">
import { computed, ref } from 'vue';
import { useRoute } from 'vue-router';
import { useStickyTop } from './composables';
import AppHeader from './components/AppHeader.vue';
import CertificateBanner from './components/CertificateBanner.vue';
import ConfirmHost from './components/ConfirmHost.vue';
import ItemModal from './components/ItemModal.vue';
import ImpersonationBanner from './components/ImpersonationBanner.vue';
import SystemAlertsBanner from './components/SystemAlertsBanner.vue';
import TestModeBanner from './components/TestModeBanner.vue';
import ToastHost from './components/ToastHost.vue';
import { useSession } from './stores/session';

const route = useRoute();
const session = useSession();
// Das Portal hat eine eigene Kopfzeile (PortalLayout)
const showHeader = computed(
  () => session.isStaff && !route.meta.public && !route.matched.some((r) => r.meta.portal),
);
// Hinweisbalken und Kopfzeile kleben gemeinsam oben
const topBar = ref<HTMLElement | null>(null);
useStickyTop(topBar);
// Wechselt die Anmeldung in einem anderen Tab, lädt dieser neu
session.watchOtherTabs();
</script>

<template>
  <div v-if="showHeader" ref="topBar" class="top-bar">
    <ImpersonationBanner />
    <TestModeBanner />
    <CertificateBanner />
    <SystemAlertsBanner />
    <AppHeader />
  </div>
  <main>
    <RouterView />
  </main>
  <ToastHost />
  <!-- Vorgang im Fenster (Einstellung «Fenster»), über ?item=123 -->
  <ItemModal v-if="showHeader" />
  <ConfirmHost />
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
</style>
