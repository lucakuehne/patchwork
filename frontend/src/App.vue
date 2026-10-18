<script setup lang="ts">
import { computed } from 'vue';
import { useRoute } from 'vue-router';
import AppHeader from './components/AppHeader.vue';
import ConfirmHost from './components/ConfirmHost.vue';
import ToastHost from './components/ToastHost.vue';
import { useSession } from './stores/session';

const route = useRoute();
const session = useSession();
// Das Portal hat eine eigene Kopfzeile (PortalLayout)
const showHeader = computed(
  () => session.isStaff && !route.meta.public && !route.matched.some((r) => r.meta.portal),
);
</script>

<template>
  <AppHeader v-if="showHeader" />
  <main>
    <RouterView />
  </main>
  <ToastHost />
  <ConfirmHost />
</template>
