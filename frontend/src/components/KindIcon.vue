<script setup lang="ts">
/** Symbol für «Öffentlich» (Weltkugel) und «Intern» (Schloss), im Antwortfeld und in der Timeline. */
defineProps<{ kind: 'public' | 'internal' }>();
</script>

<template>
  <svg class="kind-icon" viewBox="0 0 16 16" aria-hidden="true">
    <template v-if="kind === 'public'">
      <circle cx="8" cy="8" r="6.2" />
      <path d="M1.8 8h12.4M8 1.8c1.8 1.7 2.7 3.8 2.7 6.2S9.8 12.5 8 14.2C6.2 12.5 5.3 10.4 5.3 8S6.2 3.5 8 1.8z" />
    </template>
    <template v-else>
      <rect x="3" y="7" width="10" height="7.2" rx="1.4" />
      <path d="M5.3 7V5.2a2.7 2.7 0 0 1 5.4 0V7" />
    </template>
  </svg>
</template>

<style scoped>
.kind-icon {
  width: 14px;
  height: 14px;
  flex-shrink: 0;
  vertical-align: -2px;
  fill: none;
  stroke: currentColor;
  stroke-width: 1.4;
  stroke-linecap: round;
  stroke-linejoin: round;
}
</style>
