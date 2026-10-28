<script setup lang="ts">
import { useSession } from '../stores/session';

/**
 * Logo in Kopfzeile, Portal, Anmeldung und Ersteinrichtung: das eigene Logo aus der Verwaltung oder das Patchwork-Logo
 * (Signet und Schriftzug, public/logo.svg), unabhängig vom eingestellten Namen. «compact»: auf schmalen Bildschirmen
 * nur das Signet (public/favicon.svg).
 */
withDefaults(defineProps<{ size?: 'header' | 'large'; compact?: boolean }>(), { size: 'header', compact: false });
const session = useSession();
</script>

<template>
  <!-- Klassen mit Präfix: die Wurzel erbt die Stile der Elternkomponente (dort z.B. «.header») -->
  <img v-if="session.logoUrl" :src="session.logoUrl" :alt="session.appName" class="app-logo custom" :class="`logo-${size}`" />
  <span v-else class="app-logo" :class="[`logo-${size}`, { 'logo-compact': compact }]" role="img" aria-label="Patchwork">
    <img src="/logo.svg" alt="" class="full" />
    <img v-if="compact" src="/favicon.svg" alt="" class="mark" />
  </span>
</template>

<style scoped>
.app-logo {
  display: inline-flex;
  flex-shrink: 0;
}
.app-logo img {
  display: block;
  height: 100%;
}
.logo-header {
  height: 28px;
}
.logo-large {
  height: 48px;
}
/* Eigenes Logo: beliebiges Seitenverhältnis, nicht breiter als das Patchwork-Logo */
.custom {
  object-fit: contain;
}
.custom.logo-header {
  max-width: 160px;
}
.custom.logo-large {
  max-width: 240px;
}
.logo-compact .mark {
  display: none;
}
@media (max-width: 560px) {
  .logo-compact .full {
    display: none;
  }
  .logo-compact .mark {
    display: block;
  }
}
</style>
