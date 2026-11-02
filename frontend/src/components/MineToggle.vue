<script setup lang="ts">
const model = defineModel<boolean>({ required: true });
/** Hinweis beim Darüberfahren, wenn «Nur meine» mehr zeigt als die zugewiesenen (Störungen) */
defineProps<{ title?: string }>();
</script>

<template>
  <label class="checkbox mine" :title="title">
    <input v-model="model" type="checkbox" />
    Nur meine
  </label>
</template>

<style scoped>
.mine {
  padding: 0 4px;
  font-weight: 500;
}
</style>
