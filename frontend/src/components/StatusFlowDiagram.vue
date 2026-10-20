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
import { TARGET_SHORT, TARGET_SYMBOLS, targetsOf } from '../status-admin';
import { diagramPosition, TARGET_LABELS } from '../status-flow';
import type { Status, StatusColor, StatusTarget, StatusTargets } from '../types';
import StatusFlowEdge from './StatusFlowEdge.vue';

/**
 * Bearbeitbares Ablaufdiagramm der Status eines Typs: Kästchen verschieben, Pfeil vom Punkt rechts an einem Status auf
 * einen anderen ziehen, Pfeil anklicken und mit Entf löschen (oder doppelklicken). Die Ziel-Status (automatische
 * Wechsel) erscheinen als Marken; ein Klick darauf meldet das Ziel («target»), damit die Seite zum Feld springt.
 */
const props = defineProps<{
  statuses: Status[];
  transitions: { fromId: string; toId: string }[];
  restricted: boolean;
  targets: StatusTargets;
}>();
const emit = defineEmits<{
  transitions: [list: { fromId: string; toId: string }[]];
  move: [id: string, x: number, y: number];
  target: [target: StatusTarget];
}>();

type Mark = keyof typeof TARGET_SYMBOLS;
const MARKS: Mark[] = ['reply', 'close', 'reject', 'waiting'];

interface StatusNodeData {
  label: string;
  color: StatusColor;
  /** Abgeschlossen: Doppelrahmen */
  closed: boolean;
  /** Start-Status: Startpunkt links */
  start: boolean;
  /** Übrige Ziele, die auf diesen Status zeigen, als kleine Schilder */
  marks: Mark[];
  /** Eingeschränkter Ablauf, aber kein Pfeil führt hierher: von Hand nicht erreichbar (Hinweis als Tooltip) */
  unreachable: string | null;
}

const ids = computed(() => new Set(props.statuses.map((s) => s.id)));
const own = computed(() => props.transitions.filter((t) => ids.value.has(t.fromId) && ids.value.has(t.toId)));
const nodes = ref<Node<StatusNodeData>[]>([]);

function unreachable(s: Status): string | null {
  if (!props.restricted || s.id === props.targets.start || own.value.some((t) => t.toId === s.id)) return null;
  return s.id === props.targets.reject
    ? 'Kein Pfeil führt hierher: «Ablehnen» ist aus keinem Status möglich'
    : 'Kein Pfeil führt hierher: von Hand nicht erreichbar';
}

watch(
  () => [props.statuses, props.transitions, props.restricted, props.targets],
  () => {
    nodes.value = props.statuses.map((s) => {
      const targets = targetsOf(props.targets, s.id);
      return {
        id: s.id,
        type: 'status',
        position: diagramPosition(s, props.statuses, props.targets),
        deletable: false,
        data: {
          label: s.label,
          color: s.color,
          closed: s.closed,
          start: targets.includes('start'),
          marks: MARKS.filter((m) => targets.includes(m)),
          unreachable: unreachable(s),
        },
      };
    });
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

/**
 * Pfeile in jeden anderen Status, auch in den Ablehnen-Status (sie bestimmen, woraus «Ablehnen» möglich ist). Gilt auch
 * für die vorhandenen Pfeile (Vue Flow prüft sie beim Zeichnen), deshalb hier keine Prüfung auf Doppelte.
 */
function isValid(c: Connection): boolean {
  return c.source !== c.target;
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

/** Legende: nur die Marken, die es in diesem Typ gibt */
const legendMarks = computed(() => MARKS.filter((m) => props.targets[m]));
</script>

<template>
  <div class="status-flow">
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
          <Handle class="drop" type="target" :position="Position.Left" :connectable-start="false" />
          <button
            v-if="data.start"
            class="start-mark nodrag"
            type="button"
            :title="TARGET_LABELS.start"
            :aria-label="TARGET_LABELS.start"
            @click.stop="emit('target', 'start')"
          >
            <svg width="26" height="10" viewBox="0 0 26 10" aria-hidden="true">
              <circle cx="4" cy="5" r="4" />
              <path d="M8 5 H20" />
              <path d="M19 1.5 L25 5 L19 8.5 Z" />
            </svg>
          </button>
          <div
            class="node"
            :class="{ unreachable: data.unreachable, closed: data.closed }"
            :style="{ background: `var(--st-${data.color}-bg)`, color: `var(--st-${data.color})` }"
            :title="data.unreachable ?? undefined"
          >
            {{ data.label }}<span v-if="data.unreachable" aria-hidden="true"> ⚠</span>
          </div>
          <span v-if="data.marks.length" class="marks">
            <button
              v-for="m in data.marks as Mark[]"
              :key="m"
              class="mark nodrag"
              type="button"
              :title="TARGET_LABELS[m]"
              :aria-label="TARGET_LABELS[m]"
              @click.stop="emit('target', m)"
            >
              {{ TARGET_SYMBOLS[m] }}
            </button>
          </span>
          <Handle type="source" :position="Position.Right" title="Ziehen, um einen Pfeil zu zeichnen" />
        </template>
        <template #edge-status="edgeProps">
          <StatusFlowEdge v-bind="edgeProps" />
        </template>
      </VueFlow>
    </div>
    <div class="legend faint">
      <span class="legend-item">
        <svg width="26" height="10" viewBox="0 0 26 10" class="legend-start" aria-hidden="true">
          <circle cx="4" cy="5" r="4" />
          <path d="M8 5 H20" />
          <path d="M19 1.5 L25 5 L19 8.5 Z" />
        </svg>
        {{ TARGET_SHORT.start }}
      </span>
      <span v-for="m in legendMarks" :key="m" class="legend-item" :title="TARGET_LABELS[m]">
        <span class="mark legend-mark" aria-hidden="true">{{ TARGET_SYMBOLS[m] }}</span>{{ TARGET_SHORT[m] }}
      </span>
      <span class="legend-item"><span class="legend-box closed" aria-hidden="true" />abgeschlossen</span>
      <span v-if="restricted" class="legend-item">
        <span class="legend-box unreachable" aria-hidden="true" />von Hand nicht erreichbar
      </span>
    </div>
  </div>
</template>

<style scoped>
.status-flow {
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.flow {
  flex: 1;
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
/* Doppelrahmen: zweiter Rand mit etwas Abstand aussen */
.node.closed {
  box-shadow:
    0 0 0 2px var(--surface-2),
    0 0 0 3px var(--border-strong);
}
.node.unreachable {
  border-style: dashed;
}
/* Startpunkt links am Start-Status */
.start-mark {
  position: absolute;
  top: 50%;
  right: calc(100% + 4px);
  transform: translateY(-50%);
  display: flex;
  padding: 2px;
  border: 0;
  background: none;
  color: var(--text-muted);
  cursor: pointer;
}
.start-mark svg,
.legend-start {
  fill: currentColor;
  stroke: currentColor;
  stroke-width: 1.5;
}
/* Schilder der übrigen Ziele oben rechts am Status */
.marks {
  position: absolute;
  top: -10px;
  right: -6px;
  display: flex;
  gap: 2px;
}
.mark {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 18px;
  height: 18px;
  padding: 0;
  border-radius: 50%;
  border: 1px solid var(--border-strong);
  background: var(--surface);
  color: var(--text-muted);
  font: inherit;
  font-size: 11px;
  line-height: 1;
}
button.mark,
.start-mark {
  cursor: pointer;
}
button.mark:hover,
.start-mark:hover {
  color: var(--accent);
  border-color: var(--accent);
}
.flow.connecting .marks,
.flow.connecting .start-mark {
  pointer-events: none;
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
.legend {
  display: flex;
  flex-wrap: wrap;
  gap: 4px 14px;
  font-size: 12px;
}
.legend-item {
  display: inline-flex;
  align-items: center;
  gap: 5px;
}
.legend-mark {
  width: 16px;
  height: 16px;
  font-size: 10px;
}
.legend-box {
  width: 18px;
  height: 12px;
  border-radius: 3px;
  border: 1px solid var(--border-strong);
  background: var(--surface);
}
.legend-box.closed {
  margin: 0 2px;
  box-shadow:
    0 0 0 2px var(--surface),
    0 0 0 3px var(--border-strong);
}
.legend-box.unreachable {
  border-style: dashed;
}
</style>
