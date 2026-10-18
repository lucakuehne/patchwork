<script setup lang="ts">
import { computed } from 'vue';
import { useRoute } from 'vue-router';
import PagedList from '../components/PagedList.vue';

const route = useRoute();
const q = computed(() => (typeof route.query.q === 'string' ? route.query.q : ''));
</script>

<template>
  <div class="page">
    <div class="page-head">
      <h1>Suche</h1>
      <span class="muted">«{{ q }}» in allen Vorgängen, inklusive abgeschlossener und verworfener</span>
    </div>
    <PagedList view="search" :mine="false" :initial-query="q" show-type show-status empty-text="Keine Treffer" />
  </div>
</template>
