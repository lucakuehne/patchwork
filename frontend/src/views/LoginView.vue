<script setup lang="ts">
import { ref } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { errorMessage } from '../api';
import AppLogo from '../components/AppLogo.vue';
import { useSession } from '../stores/session';

const session = useSession();
const route = useRoute();
const router = useRouter();

const username = ref('');
const password = ref('');
const busy = ref(false);
const error = ref('');

async function submit() {
  busy.value = true;
  error.value = '';
  try {
    await session.login(username.value, password.value);
    const next = route.query.next;
    // Nur interne Pfade, keine fremden Adressen («//host»)
    const internal = typeof next === 'string' && next.startsWith('/') && !next.startsWith('//');
    await router.replace(internal ? next : session.isStaff ? '/inbox' : '/portal');
  } catch (err) {
    error.value = errorMessage(err);
  } finally {
    busy.value = false;
  }
}
</script>

<template>
  <div class="auth-page">
    <form class="card auth-card" @submit.prevent="submit">
      <h1 class="brand"><AppLogo size="large" /></h1>
      <div class="field">
        <label for="login-user">Benutzername oder E-Mail</label>
        <input id="login-user" v-model="username" class="input" autocomplete="username" autofocus required />
      </div>
      <div class="field">
        <label for="login-pass">Passwort</label>
        <input id="login-pass" v-model="password" class="input" type="password" autocomplete="current-password" required />
      </div>
      <div v-if="error" class="error-box">{{ error }}</div>
      <button class="btn btn-primary" type="submit" :disabled="busy">Anmelden</button>
    </form>
  </div>
</template>

<style scoped>
.auth-page {
  min-height: 100vh;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 16px;
}
.auth-card {
  width: 100%;
  max-width: 380px;
  padding: 28px;
  display: flex;
  flex-direction: column;
  gap: 14px;
}
.brand {
  display: flex;
  justify-content: center;
  margin: 4px 0 10px;
}
</style>
