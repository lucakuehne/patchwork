<script setup lang="ts">
import { PRIORITY_LABELS } from '../format';
import type { Priority } from '../types';

defineProps<{ priority: Priority }>();
</script>

<template>
  <span class="prio" :class="`prio-${priority}`">{{ PRIORITY_LABELS[priority] }}</span>
</template>
