<script setup lang="ts">
import { computed, ref } from 'vue';
import { formatDateTime } from '../format';
import type { ItemKey } from '../item-ref';
import { deliveryMark } from '../outgoing';
import { mailRecipientsText } from '../timeline';
import type { ItemMail } from '../types';
import SentMailDialog from './SentMailDialog.vue';

/**
 * Automatische Mail an Melder und Beteiligte als kurze graue Zeile im Verlauf, z.B. «Mail «Erledigt» an Anna Muster»;
 * eine Marke nur bei Abweichungen (nicht versendet, Fehler). «ansehen» zeigt die Mail.
 */
const props = defineProps<{ mail: ItemMail; itemKey: ItemKey }>();

const open = ref(false);
const recipients = computed(() => mailRecipientsText(props.mail));
const emails = computed(() => [...props.mail.to, ...props.mail.cc].map((r) => r.email));
const mark = computed(() =>
  deliveryMark({ ...props.mail, withheld: emails.value.filter((e) => !props.mail.deliveredTo.includes(e)) }),
);
</script>

<template>
  <div class="mail-line">
    <svg class="mail-icon" viewBox="0 0 16 16" aria-hidden="true">
      <rect x="1.8" y="3.5" width="12.4" height="9" rx="1.4" />
      <path d="M2.3 4.3 8 8.8l5.7-4.5" />
    </svg>
    <span class="text">
      Mail «{{ mail.label }}» <span :title="emails.join(', ')">{{ recipients }}</span>
    </span>
    <span v-if="mark" class="badge" :class="mark.kind" :title="mark.title">{{ mark.text }}</span>
    <button class="link-btn small" type="button" @click="open = true">ansehen</button>
    <span class="spacer" />
    <span class="time">{{ formatDateTime(mail.createdAt) }}</span>
    <SentMailDialog v-if="open" :item-key="itemKey" :mail-id="mail.id" :status="mail.status" @close="open = false" />
  </div>
</template>

<style scoped>
.mail-line {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 4px 8px;
  background: var(--surface-2);
  border: 1px solid var(--border);
  border-radius: var(--radius);
  padding: 6px 12px;
  font-size: 13px;
  color: var(--text-muted);
}
.mail-icon {
  width: 14px;
  height: 14px;
  flex-shrink: 0;
  fill: none;
  stroke: currentColor;
  stroke-width: 1.4;
  stroke-linecap: round;
  stroke-linejoin: round;
}
.text {
  min-width: 0;
  overflow-wrap: anywhere;
}
.small {
  font-size: 12px;
}
.time {
  font-size: 12px;
  color: var(--text-faint);
  white-space: nowrap;
}
.badge.held {
  background: var(--warning-soft);
  color: var(--warning);
}
.badge.failed {
  background: var(--danger-soft);
  color: var(--danger);
}
.badge.queued {
  background: var(--surface);
  color: var(--text-muted);
}
</style>
