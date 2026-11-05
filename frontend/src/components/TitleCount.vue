<script setup lang="ts">
import { computed } from 'vue';
import { TITLE_MAX } from '../format';

/**
 * Zähler zum Titel (Entscheid vom 05.11.2026): ab 60 Zeichen «63/75», darüber rot mit «bitte kürzen» (z.B. ein langer
 * Titel aus einem Mail-Betreff beim Bearbeiten). Darunter nichts.
 */
const props = defineProps<{ value: string }>();
const length = computed(() => props.value.trim().length);
</script>

<template>
  <span v-if="length >= 60" class="title-count" :class="{ over: length > TITLE_MAX }" aria-live="polite">
    {{ length }}/{{ TITLE_MAX }}<template v-if="length > TITLE_MAX"> · bitte kürzen</template>
  </span>
</template>

<style scoped>
.title-count {
  align-self: flex-end;
  font-size: 12px;
  color: var(--text-faint);
  white-space: nowrap;
}
.over {
  color: var(--danger);
  font-weight: 600;
}
</style>
