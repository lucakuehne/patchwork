<script setup lang="ts">
import { useRouter } from 'vue-router';
import TestModeBanner from '../../components/TestModeBanner.vue';
import { useSession } from '../../stores/session';

const session = useSession();
const router = useRouter();

async function logout() {
  try {
    await session.logout();
  } finally {
    await router.push({ name: 'login' });
  }
}
</script>

<template>
  <TestModeBanner />
  <header class="portal-header">
    <RouterLink to="/portal" class="brand">
      <img v-if="session.logoUrl" :src="session.logoUrl" alt="" class="logo" />
      <span>{{ session.appName }}</span>
    </RouterLink>
    <nav class="nav">
      <RouterLink to="/portal" class="nav-link" exact-active-class="active">Meine Vorgänge</RouterLink>
      <RouterLink to="/portal/neu" class="nav-link" active-class="active">Neue Meldung</RouterLink>
    </nav>
    <div class="spacer" />
    <span class="user muted">{{ session.user?.name }}</span>
    <button class="btn btn-ghost btn-sm" type="button" @click="logout">Abmelden</button>
  </header>
  <div class="portal-page">
    <RouterView />
  </div>
</template>

<style scoped>
.portal-header {
  position: sticky;
  top: 0;
  z-index: 50;
  display: flex;
  align-items: center;
  gap: 16px;
  height: 56px;
  padding: 0 20px;
  background: var(--surface);
  border-bottom: 1px solid var(--border);
}
.brand {
  display: flex;
  align-items: center;
  gap: 8px;
  font-weight: 700;
  font-size: 16px;
  color: var(--text);
  text-decoration: none;
  white-space: nowrap;
}
.logo {
  height: 28px;
  max-width: 120px;
  object-fit: contain;
}
.nav {
  display: flex;
  gap: 4px;
}
.nav-link {
  padding: 6px 10px;
  border-radius: var(--radius-sm);
  color: var(--text-muted);
  font-weight: 500;
  text-decoration: none;
  white-space: nowrap;
}
.nav-link:hover {
  background: var(--surface-hover);
  text-decoration: none;
}
.nav-link.active {
  background: var(--accent-soft);
  color: var(--accent);
}
.portal-page {
  max-width: 900px;
  margin: 0 auto;
  padding: 24px 16px 48px;
}
@media (max-width: 640px) {
  .user,
  .brand span {
    display: none;
  }
  .portal-header {
    gap: 8px;
    padding: 0 12px;
  }
}
</style>
