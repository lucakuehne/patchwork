import { defineStore } from 'pinia';
import { ref } from 'vue';

export interface ConfirmRequest {
  title: string;
  message: string;
  confirmLabel: string;
  /** Beschriftung des zweiten Knopfs, Standard «Abbrechen» */
  cancelLabel?: string;
  danger?: boolean;
}

/** Rückfrage als Dialog: `if (await confirm.ask({...})) …` */
export const useConfirm = defineStore('confirm', () => {
  const request = ref<ConfirmRequest | null>(null);
  let resolver: ((value: boolean) => void) | null = null;

  function ask(r: ConfirmRequest): Promise<boolean> {
    resolver?.(false);
    request.value = r;
    return new Promise((resolve) => (resolver = resolve));
  }

  function answer(value: boolean) {
    resolver?.(value);
    resolver = null;
    request.value = null;
  }

  return { request, ask, answer };
});
