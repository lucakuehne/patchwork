<script setup lang="ts">
import { useSession } from '../stores/session';

// «Abgelehnt» nur, wenn es für Aufgaben ein Ablehnen-Ziel gibt
const session = useSession();
</script>

<template>
  <div class="segmented">
    <RouterLink to="/tasks">Offen</RouterLink>
    <RouterLink to="/tasks/done">Erledigt</RouterLink>
    <RouterLink v-if="session.statusTargets.task.reject" to="/tasks/rejected">Abgelehnt</RouterLink>
  </div>
</template>
