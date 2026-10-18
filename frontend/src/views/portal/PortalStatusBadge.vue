<script setup lang="ts">
import type { PortalStatus } from '../../types';

defineProps<{ status: PortalStatus }>();

const CLASS: Record<PortalStatus['key'], string> = {
  received: 'cat-new',
  in_progress: 'cat-in_progress',
  // Der Melder ist am Zug: hervorheben
  waiting: 'attention',
  done: 'cat-done',
  rejected: 'cat-rejected',
};
</script>

<template>
  <span class="badge" :class="CLASS[status.key]">{{ status.label }}</span>
</template>

<style scoped>
.attention {
  background: var(--accent);
  color: #fff;
}
</style>
