<script setup lang="ts">
import {
  ConnectionLineType,
  Handle,
  MarkerType,
  Position,
  VueFlow,
  type Connection,
  type EdgeChange,
  type EdgeMouseEvent,
  type Node,
  type NodeDragEvent,
} from '@vue-flow/core';
import '@vue-flow/core/dist/style.css';
import '@vue-flow/core/dist/theme-default.css';
import { computed, ref, watch } from 'vue';
import { diagramPosition } from '../status-flow';
import type { Status, StatusColor } from '../types';
import StatusFlowEdge from './StatusFlowEdge.vue';

/**
 * Bearbeitbares Ablaufdiagramm der Status eines Typs: Kästchen verschieben, Pfeil vom Punkt rechts an einem Status auf
 * einen anderen ziehen, Pfeil anklicken und mit Entf löschen (oder doppelklicken).
 */
const props = defineProps<{ statuses: Status[]; transitions: { fromId: string; toId: string }[]; restricted: boolean }>();
const emit = defineEmits<{
  transitions: [list: { fromId: string; toId: string }[]];
  move: [id: string, x: number, y: number];
}>();

interface StatusNodeData {
  label: string;
  color: StatusColor;
  /** In «Abgelehnt» führt nur «Ablehnen», deshalb kein Anschluss für eingehende Pfeile */
  rejected: boolean;
  /** Eingeschränkter Ablauf, aber kein Pfeil führt hierher: von Hand nicht erreichbar */
  unreachable: boolean;
}

const ids = computed(() => new Set(props.statuses.map((s) => s.id)));
const own = computed(() => props.transitions.filter((t) => ids.value.has(t.fromId) && ids.value.has(t.toId)));
const nodes = ref<Node<StatusNodeData>[]>([]);

watch(
  () => [props.statuses, props.transitions, props.restricted],
  () => {
    nodes.value = props.statuses.map((s) => ({
      id: s.id,
      type: 'status',
      position: diagramPosition(s, props.statuses),
      deletable: false,
      data: {
        label: s.label,
        color: s.color,
        rejected: s.category === 'rejected',
        unreachable:
          props.restricted && s.category !== 'new' && s.category !== 'rejected' && !own.value.some((t) => t.toId === s.id),
      },
    }));
  },
  { immediate: true, deep: true },
);

const arrow = { type: MarkerType.ArrowClosed, width: 16, height: 16 };

const edges = computed(() =>
  own.value.map((t) => ({
    id: `${t.fromId}>${t.toId}`,
    source: t.fromId,
    target: t.toId,
    type: 'status',
    markerEnd: arrow,
    deletable: true,
    data: { curved: own.value.some((r) => r.fromId === t.toId && r.toId === t.fromId) },
  })),
);

/** Während man einen Pfeil zieht, nimmt jeder ganze Status ihn an, nicht nur ein Anschlusspunkt */
const connecting = ref(false);

const byId = (id: string) => props.statuses.find((s) => s.id === id);

/** Gilt auch für die vorhandenen Pfeile (Vue Flow prüft sie beim Zeichnen), deshalb hier keine Prüfung auf Doppelte */
function isValid(c: Connection): boolean {
  return c.source !== c.target && byId(c.target)?.category !== 'rejected';
}

function onConnect(c: Connection) {
  const exists = own.value.some((t) => t.fromId === c.source && t.toId === c.target);
  if (isValid(c) && !exists) emit('transitions', [...own.value, { fromId: c.source, toId: c.target }]);
}

function remove(ids: Set<string>) {
  if (ids.size) emit('transitions', own.value.filter((t) => !ids.has(`${t.fromId}>${t.toId}`)));
}

function onEdgesChange(changes: EdgeChange[]) {
  remove(new Set(changes.filter((c) => c.type === 'remove').map((c) => c.id)));
}

function onEdgeDoubleClick(e: EdgeMouseEvent) {
  remove(new Set([e.edge.id]));
}

function onDragStop(e: NodeDragEvent) {
  for (const n of e.nodes) emit('move', n.id, Math.round(n.position.x), Math.round(n.position.y));
}
</script>

<template>
  <div class="flow" :class="{ connecting }">
    <VueFlow
      v-model:nodes="nodes"
      :edges="edges"
      :is-valid-connection="isValid"
      :connect-on-click="false"
      :connection-line-options="{ type: ConnectionLineType.Straight, markerEnd: arrow }"
      :delete-key-code="['Delete', 'Backspace']"
      :min-zoom="0.4"
      :max-zoom="1.1"
      :zoom-on-scroll="false"
      :prevent-scrolling="false"
      fit-view-on-init
      @connect="onConnect"
      @connect-start="connecting = true"
      @connect-end="connecting = false"
      @edges-change="onEdgesChange"
      @edge-double-click="onEdgeDoubleClick"
      @node-drag-stop="onDragStop"
    >
      <template #node-status="{ data }">
        <!-- Ablagefläche über dem ganzen Status, nur beim Ziehen eines Pfeils aktiv -->
        <Handle v-if="!data.rejected" class="drop" type="target" :position="Position.Left" :connectable-start="false" />
        <div
          class="node"
          :class="{ unreachable: data.unreachable }"
          :style="{ background: `var(--st-${data.color}-bg)`, color: `var(--st-${data.color})` }"
          :title="data.unreachable ? 'Kein Pfeil führt hierher: von Hand nicht erreichbar' : undefined"
        >
          {{ data.label }}<span v-if="data.unreachable" aria-hidden="true"> ⚠</span>
        </div>
        <Handle type="source" :position="Position.Right" title="Ziehen, um einen Pfeil zu zeichnen" />
      </template>
      <template #edge-status="edgeProps">
        <StatusFlowEdge v-bind="edgeProps" />
      </template>
    </VueFlow>
  </div>
</template>

<style scoped>
.flow {
  height: 100%;
  min-height: 320px;
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  background: var(--surface-2);
}
.node {
  padding: 8px 14px;
  border-radius: 8px;
  border: 1px solid var(--border-strong);
  font-size: 13px;
  font-weight: 600;
  white-space: nowrap;
}
.node.unreachable {
  border-style: dashed;
}
.flow :deep(.vue-flow__handle) {
  width: 10px;
  height: 10px;
  background: var(--surface);
  border: 2px solid var(--text-faint);
}
.flow :deep(.vue-flow__handle.drop) {
  left: 0;
  top: 0;
  width: 100%;
  height: 100%;
  transform: none;
  border: 0;
  border-radius: 8px;
  background: transparent;
  pointer-events: none;
}
.flow.connecting :deep(.vue-flow__handle.drop) {
  pointer-events: all;
}
.flow.connecting :deep(.vue-flow__handle.drop.valid) {
  box-shadow: 0 0 0 2px var(--accent);
}
.flow :deep(.vue-flow__edge-path),
.flow :deep(.vue-flow__connection-path) {
  stroke: var(--text-muted);
  stroke-width: 1.5;
}
.flow :deep(.vue-flow__edge.selected .vue-flow__edge-path) {
  stroke: var(--accent);
  stroke-width: 2;
}
.flow :deep(.vue-flow__arrowhead polyline) {
  stroke: var(--text-muted) !important;
  fill: var(--text-muted) !important;
}
</style>
