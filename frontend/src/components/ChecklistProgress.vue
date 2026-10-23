<script setup lang="ts">
import { computed } from 'vue';

/**
 * Fortschritt der Checklisten als schmaler Balken mit «3/5» daneben (Board-Karten und Listen).
 * «fill»: Der Balken füllt die verfügbare Breite (Board-Karten).
 */
const props = defineProps<{ done: number; total: number; fill?: boolean }>();

const percent = computed(() => (props.total > 0 ? Math.round((props.done / props.total) * 100) : 0));
const complete = computed(() => props.total > 0 && props.done === props.total);
</script>

<template>
  <span class="checklist-progress" :class="{ complete, stretch: fill }" :title="`Checklisten: ${done} von ${total} erledigt`">
    <span
      class="bar"
      role="progressbar"
      :aria-valuenow="done"
      aria-valuemin="0"
      :aria-valuemax="total"
      :aria-label="`Checklisten: ${done} von ${total} erledigt`"
    >
      <span class="fill" :style="{ width: `${percent}%` }" />
    </span>
    <span class="count">{{ done }}/{{ total }}</span>
  </span>
</template>

<style scoped>
.checklist-progress {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-size: 12px;
  color: var(--text-muted);
  white-space: nowrap;
  vertical-align: middle;
}
.bar {
  position: relative;
  width: 56px;
  height: 6px;
  border-radius: 3px;
  background: var(--border);
  overflow: hidden;
}
.stretch {
  display: flex;
  width: 100%;
}
.stretch .bar {
  flex: 1;
  width: auto;
}
.fill {
  position: absolute;
  inset: 0 auto 0 0;
  border-radius: 3px;
  background: var(--accent);
}
.complete .fill {
  background: var(--success);
}
.complete .count {
  color: var(--success);
}
.count {
  font-variant-numeric: tabular-nums;
}
</style>
