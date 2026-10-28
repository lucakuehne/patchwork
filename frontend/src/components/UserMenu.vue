<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { initials } from '../format';
import { useSession } from '../stores/session';

/** Benutzermenü rechts in der Kopfzeile (intern und im Portal): Name und Mail, Einträge aus dem Slot, Abmelden */
const session = useSession();
const route = useRoute();
const router = useRouter();
const open = ref(false);
const root = ref<HTMLElement | null>(null);

async function logout() {
  open.value = false;
  try {
    await session.logout();
  } finally {
    await router.push({ name: 'login' });
  }
}

watch(
  () => route.fullPath,
  () => (open.value = false),
);

function closeOutside(e: MouseEvent) {
  if (!root.value?.contains(e.target as Node)) open.value = false;
}
onMounted(() => document.addEventListener('click', closeOutside));
onBeforeUnmount(() => document.removeEventListener('click', closeOutside));
</script>

<template>
  <div ref="root" class="user-menu">
    <button class="btn btn-ghost user-btn" type="button" :aria-expanded="open" @click="open = !open">
      <span class="avatar">{{ initials(session.user?.name ?? '') }}</span>
      <span class="user-name">{{ session.user?.name }}</span>
    </button>
    <div v-if="open" class="menu card">
      <div class="menu-head">
        <div>{{ session.user?.name }}</div>
        <div class="faint">{{ session.user?.email }}</div>
      </div>
      <slot />
      <button class="menu-item" type="button" @click="logout">Abmelden</button>
    </div>
  </div>
</template>

<style scoped>
.user-menu {
  position: relative;
}
.user-btn {
  padding: 0 6px;
}
.menu {
  position: absolute;
  right: 0;
  top: 40px;
  min-width: 220px;
  padding: 6px;
  display: flex;
  flex-direction: column;
  box-shadow: var(--shadow-lg);
}
.menu-head {
  padding: 6px 8px 8px;
  border-bottom: 1px solid var(--border);
  margin-bottom: 4px;
}
.menu-item,
:slotted(.menu-item) {
  padding: 7px 8px;
  border-radius: var(--radius-sm);
  background: none;
  border: none;
  text-align: left;
  font: inherit;
  color: var(--text);
  cursor: pointer;
  text-decoration: none;
}
.menu-item:hover,
:slotted(.menu-item:hover) {
  background: var(--surface-hover);
  text-decoration: none;
}
@media (max-width: 640px) {
  .user-name {
    display: none;
  }
}
</style>
