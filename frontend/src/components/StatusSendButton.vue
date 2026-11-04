<script setup lang="ts">
import { nextTick, onBeforeUnmount, ref } from 'vue';
import type { StatusColor } from '../types';

/** Eintrag der Liste: «id» null = Status bleibt */
export interface SendChoice {
  id: string | null;
  label: string;
  color: StatusColor;
  closed: boolean;
}

/**
 * Knopf «Antwort senden ▾» bzw. «Notiz speichern ▾» mit der Liste der Status (Entscheid vom 04.11.2026, Design
 * «Status beim Senden», Variante A): nichts vorgewählt, ein Klick auf einen Status sendet. Ohne Einträge (Eingang) ein
 * gewöhnlicher Knopf. Vor den abgeschlossenen Status steht eine Trennlinie.
 */
const props = defineProps<{ label: string; menuTitle: string; choices: SendChoice[]; disabled: boolean; buttonClass: string }>();
const emit = defineEmits<{ pick: [statusId: string | null] }>();

const open = ref(false);
const root = ref<HTMLElement | null>(null);
const trigger = ref<HTMLButtonElement | null>(null);
const menu = ref<HTMLElement | null>(null);
const entries = ref<HTMLButtonElement[]>([]);

/** Liste öffnen (auch über Ctrl+Enter im Textfeld): Die Liste hat den Fokus, kein Eintrag; erst die Pfeiltasten wählen */
async function show() {
  if (props.disabled) return;
  if (!props.choices.length) {
    emit('pick', null);
    return;
  }
  open.value = true;
  await nextTick();
  menu.value?.focus();
}

function close(refocus = true) {
  open.value = false;
  if (refocus) trigger.value?.focus();
}

function pick(choice: SendChoice) {
  close(false);
  emit('pick', choice.id);
}

function onKey(e: KeyboardEvent) {
  const index = entries.value.indexOf(document.activeElement as HTMLButtonElement);
  if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
    e.preventDefault();
    const count = entries.value.length;
    const next = index < 0 ? (e.key === 'ArrowDown' ? 0 : count - 1) : (index + (e.key === 'ArrowDown' ? 1 : -1) + count) % count;
    entries.value[next]?.focus();
  } else if (e.key === 'Escape') {
    e.preventDefault();
    e.stopPropagation();
    close();
  } else if (e.key === 'Tab') {
    close(false);
  }
}

function onDocClick(e: MouseEvent) {
  if (open.value && root.value && !root.value.contains(e.target as Node)) close(false);
}
document.addEventListener('click', onDocClick);
onBeforeUnmount(() => document.removeEventListener('click', onDocClick));

defineExpose({ show });
</script>

<template>
  <span ref="root" class="send">
    <button
      ref="trigger"
      class="btn"
      :class="buttonClass"
      type="button"
      :disabled="disabled"
      :aria-haspopup="choices.length ? 'menu' : undefined"
      :aria-expanded="choices.length ? open : undefined"
      @click="open ? close() : show()"
    >
      {{ label }}<span v-if="choices.length" class="caret" aria-hidden="true">▾</span>
    </button>
    <div v-if="open" ref="menu" class="menu card" role="menu" tabindex="-1" :aria-label="menuTitle" @keydown="onKey">
      <div class="menu-title">{{ menuTitle }}</div>
      <template v-for="(c, i) in choices" :key="c.id ?? 'same'">
        <div v-if="c.closed && i > 0 && !choices[i - 1]!.closed" class="divider" role="separator" />
        <button
          :ref="(el) => (entries[i] = el as HTMLButtonElement)"
          type="button"
          class="entry"
          role="menuitem"
          @click="pick(c)"
        >
          <span class="dot" :style="{ background: `var(--st-${c.color})` }" />
          {{ c.label }}
        </button>
      </template>
    </div>
  </span>
</template>

<style scoped>
.send {
  position: relative;
  display: inline-flex;
}
.caret {
  margin-left: 8px;
  font-size: 11px;
}
.menu {
  position: absolute;
  right: 0;
  top: calc(100% + 6px);
  z-index: 40;
  min-width: 260px;
  padding: 6px;
  display: flex;
  flex-direction: column;
  box-shadow: var(--shadow-lg);
}
.menu:focus {
  outline: none;
}
.menu-title {
  padding: 4px 10px 6px;
  font-size: 12px;
  color: var(--text-muted);
  white-space: nowrap;
}
.entry {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 8px 10px;
  border: 0;
  border-radius: var(--radius-sm);
  background: transparent;
  color: var(--text);
  font: inherit;
  text-align: left;
  white-space: nowrap;
  cursor: pointer;
}
.entry:hover,
.entry:focus-visible {
  background: var(--surface-2);
  outline: none;
}
.dot {
  width: 9px;
  height: 9px;
  border-radius: 50%;
  flex-shrink: 0;
}
.divider {
  height: 1px;
  margin: 4px 6px;
  background: var(--border);
}
</style>
