import { defineStore } from 'pinia';
import { ref } from 'vue';
import { errorMessage } from '../api';

export interface Toast {
  id: number;
  kind: 'success' | 'error';
  text: string;
}

export const useToast = defineStore('toast', () => {
  const toasts = ref<Toast[]>([]);
  let next = 1;

  function show(kind: Toast['kind'], text: string) {
    const id = next++;
    toasts.value.push({ id, kind, text });
    setTimeout(() => dismiss(id), kind === 'error' ? 7000 : 3500);
  }

  function dismiss(id: number) {
    toasts.value = toasts.value.filter((t) => t.id !== id);
  }

  return {
    toasts,
    success: (text: string) => show('success', text),
    error: (err: unknown) => show('error', errorMessage(err)),
    dismiss,
  };
});
