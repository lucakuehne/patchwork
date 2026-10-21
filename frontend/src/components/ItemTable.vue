<script setup lang="ts">
import { useRouter } from 'vue-router';
import { formatAge, formatDate, itemRef, TYPE_LABELS } from '../format';
import { useSession } from '../stores/session';
import type { ItemSummary } from '../types';
import ChannelIcon from './ChannelIcon.vue';
import ChecklistProgress from './ChecklistProgress.vue';
import PriorityLabel from './PriorityLabel.vue';
import StatusBadge from './StatusBadge.vue';

const props = defineProps<{
  items: ItemSummary[];
  /** Zusätzliche Spalten */
  showType?: boolean;
  showStatus?: boolean;
  showClosed?: boolean;
  emptyText?: string;
}>();
defineSlots<{ actions?(props: { item: ItemSummary }): unknown }>();

const router = useRouter();
const session = useSession();
const open = (item: ItemSummary) => router.push({ name: 'item', params: { number: item.number } });
// In der Liste nur das Symbol, die Bezeichnung beim Darüberfahren
const channelProps = (item: ItemSummary) => {
  const channel = session.channelById(item.channelId)!;
  return { icon: channel.icon, title: `Meldeweg: ${channel.label}` };
};
</script>

<template>
  <div class="card table-wrap">
    <table v-if="props.items.length" class="table">
      <thead>
        <tr>
          <th>Nr.</th>
          <th>Titel</th>
          <th v-if="showType">Typ</th>
          <th v-if="showStatus">Status</th>
          <th>Priorität</th>
          <th class="channel-head">Meldeweg</th>
          <th>Melder</th>
          <th>Zuständig</th>
          <th v-if="showClosed">Abgeschlossen</th>
          <th v-else>Alter</th>
          <th v-if="$slots.actions" />
        </tr>
      </thead>
      <tbody>
        <tr v-for="item in props.items" :key="item.id" class="clickable" @click="open(item)">
          <td class="mono nowrap muted">{{ itemRef(item.number) }}</td>
          <td class="title-cell">
            {{ item.title }}
            <ChecklistProgress v-if="item.checklist" class="progress-badge" :done="item.checklist.done" :total="item.checklist.total" />
            <span v-if="!item.type && item.suggestedType" class="badge suggestion-badge">
              Vorschlag: {{ TYPE_LABELS[item.suggestedType] }}
            </span>
          </td>
          <td v-if="showType">
            <span v-if="item.type" class="badge" :class="`type-${item.type}`">{{ TYPE_LABELS[item.type] }}</span>
            <span v-else class="badge">{{ item.discarded ? 'Verworfen' : 'Eingang' }}</span>
          </td>
          <td v-if="showStatus"><StatusBadge :status="item.status" /></td>
          <td><PriorityLabel :priority="item.priority" /></td>
          <td class="channel-cell">
            <ChannelIcon v-if="session.channelById(item.channelId)" v-bind="channelProps(item)" />
            <span v-else class="faint" title="Meldeweg ohne Angabe">–</span>
          </td>
          <td class="nowrap" :title="item.reporter.email">{{ item.reporter.name }}</td>
          <td class="nowrap">
            <span v-if="item.assignee">{{ item.assignee.name }}</span>
            <span v-else class="faint">–</span>
          </td>
          <td v-if="showClosed" class="nowrap muted">{{ formatDate(item.closedAt) }}</td>
          <td v-else class="nowrap muted" :title="formatDate(item.createdAt)">{{ formatAge(item.createdAt) }}</td>
          <td v-if="$slots.actions" class="nowrap" @click.stop>
            <slot name="actions" :item="item" />
          </td>
        </tr>
      </tbody>
    </table>
    <div v-else class="empty">{{ emptyText ?? 'Keine Vorgänge' }}</div>
  </div>
</template>

<style scoped>
.channel-head,
.channel-cell {
  width: 1%;
  text-align: center;
  color: var(--text-muted);
}
</style>
