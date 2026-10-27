<script setup lang="ts">
import { itemHref, opensInBrowser, useOpenItem } from '../open-item';
import type { ItemType } from '../types';

/**
 * Link auf einen Vorgang: öffnet ihn als Seite oder im Fenster, je nach Einstellung für seinen Typ («type»; undefined =
 * unbekannt, dann als Seite). Ctrl+Klick und die mittlere Taste öffnen wie gewohnt einen neuen Tab.
 */
const props = defineProps<{ number: number; type?: ItemType | null }>();
const openItem = useOpenItem();

function click(event: MouseEvent) {
  if (opensInBrowser(event)) return;
  event.preventDefault();
  openItem(props.number, props.type);
}
</script>

<template>
  <a :href="itemHref(number)" @click="click"><slot /></a>
</template>
