import vue from '@vitejs/plugin-vue';
import { defineConfig } from 'vite';
import vueDevTools from 'vite-plugin-vue-devtools';

export default defineConfig(({ mode }) => ({
  plugins: [
    vue(),
    // Schwebende Vue Devtools und «Element in der IDE öffnen», nur im Entwicklungsserver (Port 5173).
    // Editor über LAUNCH_EDITOR wählbar, z.B. «webstorm»; Standard ist VS Code.
    vueDevTools({ launchEditor: process.env.LAUNCH_EDITOR || 'code' }),
  ],
  // «vite build --mode devtools»: Vue Devtools (Browser-Erweiterung) auch im gebauten Frontend, nicht für Docker
  define: { __VUE_PROD_DEVTOOLS__: JSON.stringify(mode === 'devtools') },
  server: {
    port: 5173,
    proxy: {
      '/api': 'http://localhost:8080',
    },
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
  },
}));
