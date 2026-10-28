<script setup lang="ts">
import { formatDateTime, initials } from '../format';
import KindIcon from './KindIcon.vue';

/**
 * Einheitliche Kopfzeile der Einträge in der Timeline: links Avatar, Name und Art des Eintrags (mit Hinweisen),
 * rechts Aktionen und Zeitpunkt. Regeln und System («system») erhalten ein Zahnrad statt Initialen.
 */
defineProps<{
  name: string;
  system?: boolean;
  /** Art des Eintrags, z.B. «Öffentlich · per Mail» */
  kind?: string;
  icon?: 'public' | 'internal';
  time: string;
  /** Hinweis beim Darüberfahren über den Zeitpunkt */
  timeTitle?: string;
  /** Hinweis beim Darüberfahren über den Namen, z.B. «erfasst von …» (Name dann gepunktet unterstrichen) */
  nameTitle?: string;
}>();
</script>

<template>
  <div class="entry-head">
    <span class="avatar" :class="{ system }" aria-hidden="true">
      <svg v-if="system" class="gear" viewBox="0 0 16 16">
        <circle cx="8" cy="8" r="2.3" />
        <path
          d="M8 1.5v2M8 12.5v2M1.5 8h2M12.5 8h2M3.4 3.4l1.4 1.4M11.2 11.2l1.4 1.4M3.4 12.6l1.4-1.4M11.2 4.8l1.4-1.4"
        />
      </svg>
      <template v-else>{{ initials(name) }}</template>
    </span>
    <strong class="name" :class="{ hinted: !!nameTitle }" :title="nameTitle">{{ name }}</strong>
    <span v-if="kind" class="kind">
      <KindIcon v-if="icon" :kind="icon" />
      {{ kind }}
    </span>
    <slot name="badges" />
    <span class="spacer" />
    <slot name="actions" />
    <span class="time" :title="timeTitle">{{ formatDateTime(time) }}</span>
    <slot name="after-time" />
  </div>
</template>

<style scoped>
.entry-head {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 4px 8px;
  margin-bottom: 8px;
}
.name {
  color: var(--text);
}
.name.hinted {
  text-decoration: underline dotted var(--text-faint);
  text-underline-offset: 3px;
  cursor: help;
}
.kind {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  font-size: 12px;
  color: var(--text-muted);
}
.time {
  font-size: 12px;
  color: var(--text-faint);
  white-space: nowrap;
}
.avatar.system {
  background: var(--surface-2);
  color: var(--text-muted);
}
.gear {
  width: 14px;
  height: 14px;
  fill: none;
  stroke: currentColor;
  stroke-width: 1.5;
  stroke-linecap: round;
}
</style>
