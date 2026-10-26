<script setup lang="ts">
import type { PortalStatus } from '../../types';

defineProps<{ status: PortalStatus }>();
</script>

<template>
  <!-- Wartet der Vorgang auf den Melder, ist er am Zug: hervorheben -->
  <span
    class="badge"
    :class="[`st-${status.color}`, { waiting: status.waiting }]"
    :title="status.waiting ? 'Wartet auf deine Rückmeldung' : undefined"
  >
    {{ status.label }}
  </span>
</template>

<style scoped>
.waiting {
  font-weight: 700;
  box-shadow: inset 0 0 0 1.5px currentColor;
}
</style>
