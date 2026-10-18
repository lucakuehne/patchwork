<script setup lang="ts">
import MineToggle from '../components/MineToggle.vue';
import PagedList from '../components/PagedList.vue';
import TasksNav from '../components/TasksNav.vue';
import { useMineFilter } from '../composables';

defineProps<{ view: 'tasks-done' | 'tasks-rejected' }>();
const mine = useMineFilter('tasks');
</script>

<template>
  <div class="page">
    <div class="page-head">
      <h1>Aufgaben</h1>
      <TasksNav />
      <div class="spacer" />
      <MineToggle v-model="mine" />
    </div>
    <PagedList
      :view="view"
      :mine="mine"
      show-closed
      :empty-text="view === 'tasks-done' ? 'Keine erledigten Aufgaben' : 'Keine abgelehnten Aufgaben'"
    />
  </div>
</template>
