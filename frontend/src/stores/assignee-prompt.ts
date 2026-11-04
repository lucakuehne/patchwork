import { defineStore } from 'pinia';
import { ref } from 'vue';

/**
 * Fenster «Wer ist zuständig?» beim Statuswechsel in einen Status mit «Zuständig Pflicht» (Entscheid vom 04.11.2026):
 * `const id = await assigneePrompt.ask(message)`, null = abgebrochen. Nichts ist vorgewählt.
 */
export const useAssigneePrompt = defineStore('assignee-prompt', () => {
  const message = ref<string | null>(null);
  let resolver: ((value: string | null) => void) | null = null;

  function ask(text: string): Promise<string | null> {
    resolver?.(null);
    message.value = text;
    return new Promise((resolve) => (resolver = resolve));
  }

  function answer(value: string | null) {
    resolver?.(value);
    resolver = null;
    message.value = null;
  }

  return { message, ask, answer };
});
