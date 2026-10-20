<script setup lang="ts">
import { useSession } from '../stores/session';

// «Abgelehnt» nur, wenn es für Aufgaben ein Ablehnen-Ziel gibt
const session = useSession();
</script>

<template>
  <div class="segmented">
    <RouterLink to="/aufgaben">Board</RouterLink>
    <RouterLink to="/aufgaben/erledigt">Erledigt</RouterLink>
    <RouterLink v-if="session.statusTargets.task.reject" to="/aufgaben/abgelehnt">Abgelehnt</RouterLink>
  </div>
</template>
