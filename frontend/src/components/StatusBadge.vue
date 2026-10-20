<script setup lang="ts">
import type { StatusRef } from '../types';

defineProps<{ status: StatusRef | null }>();
</script>

<template>
  <span v-if="status" class="badge" :class="`st-${status.color}`">{{ status.label }}</span>
  <span v-else class="badge">Eingang</span>
</template>
