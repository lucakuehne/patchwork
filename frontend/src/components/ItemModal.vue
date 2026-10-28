<script setup lang="ts">
import { computed, defineAsyncComponent } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { itemRef } from '../format';
import { itemHref, MODAL_QUERY, modalNumber } from '../open-item';
import ModalDialog from './ModalDialog.vue';

// Erst beim ersten Öffnen laden (enthält Editor und Timeline)
const ItemView = defineAsyncComponent(() => import('../views/ItemView.vue'));

/**
 * Vorgang im grossen Fenster über der aktuellen Ansicht (Einstellung «Fenster»), gesteuert über die Adresse
 * (`?item=123`): «Zurück» im Browser schliesst es, Neuladen öffnet es wieder. «Als Seite öffnen» wechselt zur Seite.
 */
const route = useRoute();
const router = useRouter();
const number = computed(() => modalNumber(route.query));

/** Schliessen: zurück, wenn das Fenster aus dieser Ansicht geöffnet wurde, sonst die Adresse ohne Fenster */
function close() {
  const query = { ...route.query };
  delete query[MODAL_QUERY];
  const target = router.resolve({ path: route.path, query, hash: route.hash }).fullPath;
  if ((window.history.state as { back?: string } | null)?.back === target) router.back();
  else void router.replace(target);
}
</script>

<template>
  <ModalDialog v-if="number" :key="number" :title="itemRef(number)" huge @close="close">
    <template #actions>
      <RouterLink class="btn btn-sm" :to="itemHref(number)">Als Seite öffnen</RouterLink>
    </template>
    <ItemView :number="number" embedded />
  </ModalDialog>
</template>
