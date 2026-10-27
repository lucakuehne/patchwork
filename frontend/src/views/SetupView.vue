<script setup lang="ts">
import { ref } from 'vue';
import { useRouter } from 'vue-router';
import { api, errorMessage } from '../api';
import AppLogo from '../components/AppLogo.vue';
import { useSession } from '../stores/session';
import type { User } from '../types';

const session = useSession();
const router = useRouter();

const appName = ref('Patchwork');
const name = ref('');
const email = ref('');
const password = ref('');
const password2 = ref('');
const busy = ref(false);
const error = ref('');

async function submit() {
  error.value = '';
  if (password.value.length < 10) {
    error.value = 'Das Passwort muss mindestens 10 Zeichen lang sein.';
    return;
  }
  if (password.value !== password2.value) {
    error.value = 'Die Passwörter stimmen nicht überein.';
    return;
  }
  busy.value = true;
  try {
    session.user = await api.post<User>('/setup', {
      appName: appName.value,
      name: name.value,
      email: email.value,
      password: password.value,
    });
    await session.loadInfo();
    await session.loadAppData();
    await router.replace('/admin/postfaecher');
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
      <div class="brand"><AppLogo size="large" /></div>
      <div>
        <h1>Willkommen bei Patchwork</h1>
        <p class="muted">Lege den Namen der Anwendung und das erste Admin-Konto fest. Danach richtest du die Postfächer ein.</p>
      </div>
      <div class="field">
        <label for="setup-app">Name der Anwendung</label>
        <input id="setup-app" v-model="appName" class="input" required maxlength="100" />
      </div>
      <div class="field">
        <label for="setup-name">Dein Name</label>
        <input id="setup-name" v-model="name" class="input" required autocomplete="name" />
      </div>
      <div class="field">
        <label for="setup-email">E-Mail</label>
        <input id="setup-email" v-model="email" class="input" type="email" required autocomplete="email" />
      </div>
      <div class="grid-2">
        <div class="field">
          <label for="setup-pass">Passwort</label>
          <input id="setup-pass" v-model="password" class="input" type="password" required autocomplete="new-password" />
        </div>
        <div class="field">
          <label for="setup-pass2">Wiederholen</label>
          <input id="setup-pass2" v-model="password2" class="input" type="password" required autocomplete="new-password" />
        </div>
      </div>
      <span class="faint">Mindestens 10 Zeichen.</span>
      <div v-if="error" class="error-box">{{ error }}</div>
      <button class="btn btn-primary" type="submit" :disabled="busy">Einrichten</button>
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
  max-width: 480px;
  padding: 28px;
  display: flex;
  flex-direction: column;
  gap: 14px;
}
.auth-card p {
  margin: 6px 0 0;
}
.brand {
  display: flex;
  justify-content: center;
  margin: 4px 0 10px;
}
</style>
