<script setup lang="ts">
const model = defineModel<boolean>({ required: true });
</script>

<template>
  <label class="checkbox mine">
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
