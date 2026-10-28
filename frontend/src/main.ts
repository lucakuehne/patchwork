import { createPinia } from 'pinia';
import { createApp } from 'vue';
import App from './App.vue';
import { setUnauthorizedHandler } from './api';
import { reloadOnUpdate } from './reload-on-update';
import { router } from './router';
import { useSession } from './stores/session';
import { startTheme } from './theme';
import './styles.css';

startTheme();
const app = createApp(App);
app.use(createPinia());
reloadOnUpdate(router);
app.use(router);

setUnauthorizedHandler(() => {
  const session = useSession();
  session.user = null;
  if (router.currentRoute.value.name !== 'login') {
    void router.push({ name: 'login', query: { next: router.currentRoute.value.fullPath } });
  }
});

app.mount('#app');
