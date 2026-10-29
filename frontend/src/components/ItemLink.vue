<script setup lang="ts">
import type { ItemKey } from '../item-ref';
import { itemHref, opensInBrowser, useOpenItem } from '../open-item';
import type { ItemType } from '../types';

/**
 * Link auf einen Vorgang: öffnet ihn als Seite oder im Fenster, je nach Einstellung für seinen Typ («type»; undefined =
 * unbekannt, dann als Seite). Ctrl+Klick und die mittlere Taste öffnen wie gewohnt einen neuen Tab.
 */
const props = defineProps<{ itemKey: ItemKey; type?: ItemType | null }>();
const openItem = useOpenItem();

function click(event: MouseEvent) {
  if (opensInBrowser(event)) return;
  event.preventDefault();
  openItem(props.itemKey, props.type);
}
</script>

<template>
  <a :href="itemHref(itemKey)" @click="click"><slot /></a>
</template>
