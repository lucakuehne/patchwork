<script setup lang="ts">
import type { Chart } from 'chart.js';
import { onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { drawChart, type ChartSpec } from '../charts';
import { darkActive } from '../theme';

/** Balkendiagramm; wird bei neuen Daten und beim Wechsel des Farbschemas neu gezeichnet. */
const props = defineProps<{ spec: ChartSpec; height: number }>();
const canvas = ref<HTMLCanvasElement | null>(null);
let chart: Chart<'bar'> | null = null;

function draw() {
  chart?.destroy();
  if (canvas.value) chart = drawChart(canvas.value, props.spec);
}
onMounted(draw);
watch(() => props.spec, draw);
watch(darkActive, draw);
onBeforeUnmount(() => chart?.destroy());
</script>

<template>
  <div class="chart" :style="{ height: `${height}px` }">
    <canvas ref="canvas" role="img" :aria-label="spec.title" />
  </div>
</template>

<style scoped>
.chart {
  position: relative;
  width: 100%;
}
</style>
