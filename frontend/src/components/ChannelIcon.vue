<script setup lang="ts">
import type { ChannelIcon } from '../types';

/** Symbol eines Meldewegs. «title» erscheint beim Darüberfahren (in Listen steht nur das Symbol). */
defineProps<{ icon: ChannelIcon; title?: string }>();
</script>

<template>
  <svg class="channel-icon" viewBox="0 0 16 16" :role="title ? 'img' : undefined" :aria-label="title" :aria-hidden="title ? undefined : 'true'">
    <title v-if="title">{{ title }}</title>
    <template v-if="icon === 'mail'">
      <rect x="1.8" y="3.5" width="12.4" height="9" rx="1.3" />
      <path d="M2.3 4.3 8 8.7l5.7-4.4" />
    </template>
    <template v-else-if="icon === 'portal'">
      <rect x="2.3" y="3" width="11.4" height="7.6" rx="1" />
      <path d="M1 13h14M6.5 10.6v2.4M9.5 10.6v2.4" />
    </template>
    <template v-else-if="icon === 'phone'">
      <path
        d="M5.4 2.2 3.6 2.6c-.6.2-1 .8-.9 1.5.6 4.2 3.9 7.6 8.2 8.2.7.1 1.3-.3 1.5-.9l.4-1.8c.1-.4-.1-.8-.5-1l-2-.9c-.4-.2-.8-.1-1.1.2l-.7.8a7 7 0 0 1-3-3l.8-.7c.3-.3.4-.7.2-1.1l-.9-2c-.2-.4-.6-.6-1-.5z"
      />
    </template>
    <template v-else-if="icon === 'mobile'">
      <rect x="4.5" y="1.5" width="7" height="13" rx="1.4" />
      <path d="M7.2 12.4h1.6" />
    </template>
    <template v-else-if="icon === 'person'">
      <circle class="outline" cx="8" cy="5" r="2.7" />
      <path d="M2.8 14.2c.5-2.8 2.6-4.4 5.2-4.4s4.7 1.6 5.2 4.4" />
    </template>
    <template v-else-if="icon === 'chat'">
      <path d="M2 3.8c0-.8.6-1.4 1.4-1.4h9.2c.8 0 1.4.6 1.4 1.4v6c0 .8-.6 1.4-1.4 1.4H7l-3.2 2.6v-2.6h-.4c-.8 0-1.4-.6-1.4-1.4z" />
    </template>
    <template v-else-if="icon === 'video'">
      <rect x="1.5" y="4" width="9" height="8" rx="1.3" />
      <path d="m10.5 7 4-2.2v6.4l-4-2.2" />
    </template>
    <template v-else-if="icon === 'letter'">
      <path d="M4 1.8h5.5L12 4.3v9.9H4z" />
      <path d="M9.5 1.8v2.5H12M6 7.5h4M6 10h4" />
    </template>
    <template v-else-if="icon === 'alert'">
      <path d="M8 2.2c-2.3 0-4 1.8-4 4.1v2.6l-1.3 2.3h10.6L12 8.9V6.3c0-2.3-1.7-4.1-4-4.1z" />
      <path d="M6.6 13.2a1.5 1.5 0 0 0 2.8 0" />
    </template>
    <template v-else>
      <circle cx="3.5" cy="8" r="1.1" />
      <circle cx="8" cy="8" r="1.1" />
      <circle cx="12.5" cy="8" r="1.1" />
    </template>
  </svg>
</template>

<style scoped>
.channel-icon {
  width: 16px;
  height: 16px;
  flex-shrink: 0;
  vertical-align: -3px;
  fill: none;
  stroke: currentColor;
  stroke-width: 1.3;
  stroke-linecap: round;
  stroke-linejoin: round;
}
.channel-icon circle {
  fill: currentColor;
  stroke: none;
}
.channel-icon circle.outline {
  fill: none;
  stroke: currentColor;
}
</style>
