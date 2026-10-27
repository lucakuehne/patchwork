<script lang="ts">
/** Offene Dialoge, der zuletzt geöffnete zuoberst: Escape schliesst nur ihn (z.B. eine Rückfrage über einem Dialog) */
const openDialogs: symbol[] = [];
</script>

<script setup lang="ts">
import { onBeforeUnmount, onMounted } from 'vue';

/**
 * «huge»: fast bildschirmfüllend, z.B. für einen Vorgang im Fenster. Damit eine angefangene Antwort nicht verloren geht,
 * schliesst es weder ein Klick daneben noch Escape aus einem Eingabefeld. «#actions»: Knöpfe in der Kopfzeile.
 */
const props = defineProps<{ title: string; wide?: boolean; huge?: boolean }>();
const emit = defineEmits<{ close: [] }>();

const self = Symbol('dialog');
const editable = (target: EventTarget | null) =>
  target instanceof HTMLElement && !!target.closest('input, textarea, select, [contenteditable="true"]');
function onKey(e: KeyboardEvent) {
  if (e.key !== 'Escape' || openDialogs.at(-1) !== self || e.defaultPrevented) return;
  if (props.huge && editable(e.target)) return;
  emit('close');
}
function onBackdrop() {
  if (!props.huge) emit('close');
}
onMounted(() => {
  openDialogs.push(self);
  document.addEventListener('keydown', onKey);
});
onBeforeUnmount(() => {
  openDialogs.splice(openDialogs.indexOf(self), 1);
  document.removeEventListener('keydown', onKey);
});
</script>

<template>
  <Teleport to="body">
    <div class="backdrop" :class="{ huge }" @mousedown.self="onBackdrop">
      <div class="dialog card" :class="{ wide, huge }" role="dialog" aria-modal="true" :aria-label="title">
        <div class="head">
          <h2>{{ title }}</h2>
          <div class="spacer" />
          <slot name="actions" />
          <button class="btn btn-ghost btn-icon" type="button" aria-label="Schliessen" @click="emit('close')">✕</button>
        </div>
        <div class="body">
          <slot />
        </div>
        <div v-if="$slots.footer" class="foot">
          <slot name="footer" />
        </div>
      </div>
    </div>
  </Teleport>
</template>

<style scoped>
.backdrop {
  position: fixed;
  inset: 0;
  background: rgb(10 14 20 / 45%);
  display: flex;
  align-items: flex-start;
  justify-content: center;
  padding: 6vh 16px;
  z-index: 200;
  overflow-y: auto;
}
.dialog {
  width: 100%;
  max-width: 520px;
  box-shadow: var(--shadow-lg);
}
.dialog.wide {
  max-width: 760px;
}
/* Vorgang im Fenster: fast so gross wie die Seite, Hintergrund wie die Seite */
.backdrop.huge {
  padding: 2vh 16px;
}
.dialog.huge {
  max-width: min(1500px, 96vw);
}
.dialog.huge .body {
  background: var(--bg);
  border-radius: 0 0 var(--radius) var(--radius);
}
.head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding: 12px 16px;
  border-bottom: 1px solid var(--border);
}
.head .spacer {
  flex: 1;
}
.body {
  padding: 16px;
  display: flex;
  flex-direction: column;
  gap: 12px;
}
.foot {
  display: flex;
  /* Umbruch statt Überlauf, wenn die Knöpfe auf schmalen Bildschirmen nicht nebeneinander passen */
  flex-wrap: wrap;
  justify-content: flex-end;
  gap: 8px;
  padding: 12px 16px;
  border-top: 1px solid var(--border);
}
</style>
