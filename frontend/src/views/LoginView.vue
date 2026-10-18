<script setup lang="ts">
import { ref } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { errorMessage } from '../api';
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
    const weiter = route.query.weiter;
    // Nur interne Pfade, keine fremden Adressen («//host»)
    const internal = typeof weiter === 'string' && weiter.startsWith('/') && !weiter.startsWith('//');
    await router.replace(internal ? weiter : session.isStaff ? '/eingang' : '/portal');
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
      <div class="brand">
        <img v-if="session.logoUrl" :src="session.logoUrl" alt="" />
        <h1>{{ session.appName }}</h1>
      </div>
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
  flex-direction: column;
  align-items: center;
  gap: 10px;
  margin-bottom: 8px;
}
.brand img {
  max-height: 56px;
  max-width: 200px;
}
</style>
