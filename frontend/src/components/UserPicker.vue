<script setup lang="ts">
import { onBeforeUnmount, ref } from 'vue';
import { api } from '../api';
import { useToast } from '../stores/toast';
import type { PersonPick, User } from '../types';
import PersonSearch from './PersonSearch.vue';

/**
 * Auswahl einer Person (z.B. Melder) per Suche in Patchwork und im AD.
 * Personen aus dem AD und unbekannte E-Mail-Adressen werden dabei als Kontakt angelegt.
 */
const props = defineProps<{ modelValue: User | null; placeholder?: string }>();
const emit = defineEmits<{ 'update:modelValue': [User] }>();
const toast = useToast();

const open = ref(false);
const root = ref<HTMLElement | null>(null);

async function select(person: PersonPick) {
  open.value = false;
  try {
    // Liefert auch bestehende Benutzer vollständig (mit Vor- und Nachname)
    const user = await api.post<User>('/users/contacts', { email: person.email, ...(person.name ? { name: person.name } : {}) });
    emit('update:modelValue', user);
  } catch (err) {
    toast.error(err);
  }
}

function onDocClick(e: MouseEvent) {
  if (root.value && !root.value.contains(e.target as Node)) open.value = false;
}
document.addEventListener('click', onDocClick);
onBeforeUnmount(() => document.removeEventListener('click', onDocClick));
</script>

<template>
  <div ref="root" class="picker">
    <button type="button" class="input current" @click="open = !open">
      <span v-if="props.modelValue">{{ props.modelValue.name }} <span class="faint">· {{ props.modelValue.email }}</span></span>
      <span v-else class="faint">{{ placeholder ?? 'Person wählen' }}</span>
    </button>
    <div v-if="open" class="dropdown card" @keydown.esc="open = false">
      <PersonSearch autofocus @pick="select" />
    </div>
  </div>
</template>

<style scoped>
.picker {
  position: relative;
}
.current {
  text-align: left;
  cursor: pointer;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.dropdown {
  position: absolute;
  z-index: 300;
  top: 36px;
  left: 0;
  right: 0;
  min-width: 260px;
  padding: 8px;
  box-shadow: var(--shadow-lg);
}
</style>
