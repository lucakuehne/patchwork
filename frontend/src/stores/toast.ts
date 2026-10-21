import { defineStore } from 'pinia';
import { ref } from 'vue';
import { errorMessage } from '../api';

export interface Toast {
  id: number;
  kind: 'success' | 'error';
  text: string;
  /** Link in der Meldung, z.B. «Öffnen» zum neu erstellten Vorgang */
  link?: { text: string; to: string };
}

export const useToast = defineStore('toast', () => {
  const toasts = ref<Toast[]>([]);
  let next = 1;

  function show(kind: Toast['kind'], text: string, link?: Toast['link']) {
    const id = next++;
    toasts.value.push({ id, kind, text, link });
    // Mit Link etwas länger, damit man ihn erreicht
    setTimeout(() => dismiss(id), kind === 'error' ? 7000 : link ? 8000 : 3500);
  }

  function dismiss(id: number) {
    toasts.value = toasts.value.filter((t) => t.id !== id);
  }

  return {
    toasts,
    success: (text: string, link?: Toast['link']) => show('success', text, link),
    error: (err: unknown) => show('error', errorMessage(err)),
    dismiss,
  };
});
