<script setup lang="ts">
import { ref } from 'vue';
import { useRouter } from 'vue-router';
import { api, errorMessage } from '../../api';
import FilePicker from '../../components/FilePicker.vue';
import MarkdownEditor from '../../components/MarkdownEditor.vue';
import { itemRef } from '../../format';
import { useToast } from '../../stores/toast';

const router = useRouter();
const toast = useToast();

const type = ref<'incident' | 'task' | null>(null);
const title = ref('');
const description = ref('');
const files = ref<File[]>([]);
const sending = ref(false);
const error = ref('');

const choices = [
  { value: 'incident' as const, label: 'Etwas funktioniert nicht', hint: 'Etwas ging bisher und funktioniert jetzt nicht mehr.' },
  { value: 'task' as const, label: 'Ich brauche etwas', hint: 'Etwas Neues oder eine Änderung, z.B. Zugang, Gerät, Software.' },
];

async function submit() {
  error.value = '';
  if (!type.value) {
    error.value = 'Bitte wählen Sie, worum es geht.';
    return;
  }
  if (!title.value.trim()) {
    error.value = 'Bitte geben Sie einen kurzen Titel ein.';
    return;
  }
  sending.value = true;
  try {
    const form = new FormData();
    form.append('type', type.value);
    form.append('title', title.value);
    form.append('description', description.value);
    for (const f of files.value) form.append('files', f, f.name);
    const result = await api.post<{ number: number }>('/portal/items', form);
    toast.success(`Danke! Ihre Meldung ist eingegangen (${itemRef(result.number)}).`);
    await router.push(`/portal/v/${result.number}`);
  } catch (err) {
    error.value = errorMessage(err);
  } finally {
    sending.value = false;
  }
}
</script>

<template>
  <div class="stack">
    <h1>Neue Meldung</h1>
    <div class="card card-body stack">
      <div class="field">
        <span class="label">Worum geht es?</span>
        <div class="choices" role="radiogroup" aria-label="Worum geht es?">
          <button
            v-for="c in choices"
            :key="c.value"
            type="button"
            role="radio"
            class="choice"
            :class="{ active: type === c.value }"
            :aria-checked="type === c.value"
            @click="type = c.value"
          >
            <span class="choice-label">{{ c.label }}</span>
            <span class="choice-hint">{{ c.hint }}</span>
          </button>
        </div>
      </div>
      <div class="field">
        <label for="portal-title">Titel</label>
        <input id="portal-title" v-model="title" class="input" maxlength="500" placeholder="z.B. Drucker im 2. OG druckt nicht" />
      </div>
      <div class="field">
        <span class="label">Beschreibung</span>
        <MarkdownEditor
          v-model="description"
          :min-height="160"
          placeholder="Was ist passiert bzw. was brauchen Sie? Seit wann? Welche Fehlermeldung?"
          @submit="submit"
        />
      </div>
      <div class="field">
        <span class="label">Anhänge (z.B. Screenshot)</span>
        <FilePicker v-model="files" />
      </div>
      <div v-if="error" class="error-box">{{ error }}</div>
      <div class="row">
        <RouterLink to="/portal" class="btn">Abbrechen</RouterLink>
        <div class="spacer" />
        <button class="btn btn-primary" type="button" :disabled="sending" @click="submit">Meldung senden</button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.choices {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
  gap: 10px;
}
.choice {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 4px;
  padding: 14px 16px;
  border: 1px solid var(--border);
  border-radius: var(--radius);
  background: var(--surface);
  color: var(--text);
  font: inherit;
  text-align: left;
  cursor: pointer;
}
.choice:hover {
  border-color: var(--border-strong);
}
.choice.active {
  border-color: var(--accent);
  background: var(--accent-soft);
  box-shadow: inset 0 0 0 1px var(--accent);
}
.choice-label {
  font-weight: 600;
  font-size: 15px;
}
.choice-hint {
  font-size: 13px;
  color: var(--text-muted);
}
</style>
