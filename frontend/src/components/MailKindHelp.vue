<script setup lang="ts">
import type { MailKind } from '../types';
import HelpTip from './HelpTip.vue';

/** «?» zu einer Art von Mail: an wen und wann, bei Mails einer Regel der aktuelle Stand (Entscheid vom 03.11.2026) */
defineProps<{ kind: MailKind }>();
</script>

<template>
  <HelpTip :label="`Was ist «${kind.label}»?`" class="mail-kind-help">
    <strong>{{ kind.label }}</strong><br />
    {{ kind.description }}
    <template v-if="kind.state"><br /><em class="state">{{ kind.state }}</em></template>
  </HelpTip>
</template>

<style scoped>
.state {
  display: inline-block;
  margin-top: 4px;
  font-style: normal;
  font-weight: 600;
}
</style>
