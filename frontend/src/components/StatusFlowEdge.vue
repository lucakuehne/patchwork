<script setup lang="ts">
import { BaseEdge, type GraphNode } from '@vue-flow/core';
import { computed } from 'vue';
import { edgePath, type Box } from '../status-flow';

/** Pfeil im Ablaufdiagramm, von Rand zu Rand statt zwischen festen Anschlüssen (siehe edgePath) */
defineOptions({ inheritAttrs: false });
const props = defineProps<{
  id: string;
  sourceNode: GraphNode;
  targetNode: GraphNode;
  markerEnd?: string;
  data?: { curved?: boolean };
}>();

const box = (node: GraphNode): Box => ({
  x: node.computedPosition.x,
  y: node.computedPosition.y,
  width: node.dimensions.width,
  height: node.dimensions.height,
});
const path = computed(() => edgePath(box(props.sourceNode), box(props.targetNode), !!props.data?.curved));
</script>

<template>
  <BaseEdge :id="id" :path="path" :marker-end="markerEnd" />
</template>
