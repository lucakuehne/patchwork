<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { api, errorMessage } from '../api';
import { PRIORITY_LABELS } from '../format';
import { manualStatusChoices } from '../status-move';
import { useSession } from '../stores/session';
import type { ItemType, Priority, User } from '../types';
import FilePicker from './FilePicker.vue';
import MarkdownEditor from './MarkdownEditor.vue';
import ModalDialog from './ModalDialog.vue';
import TypeChoice from './TypeChoice.vue';
import UserPicker from './UserPicker.vue';

/** «fixedType»: aus der Liste der Störungen bzw. vom Board, dann ohne Typ-Auswahl */
const props = defineProps<{ initialType?: ItemType; fixedType?: ItemType }>();
const emit = defineEmits<{ close: []; created: [number: number] }>();
const session = useSession();

const type = ref<ItemType>(props.fixedType ?? props.initialType ?? 'incident');
const dialogTitle = computed(() =>
  props.fixedType === 'incident' ? 'Neue Störung' : props.fixedType === 'task' ? 'Neue Aufgabe' : 'Neuer Vorgang',
);
const title = ref('');
const description = ref('');
const priority = ref<Priority>('normal');
const reporter = ref<User | null>(session.user);
const assigneeId = ref('');
const statusId = ref('');
// Meldeweg: Pflicht, bewusst ohne Vorbelegung; «Portal» setzt Patchwork selbst
const channelId = ref('');
const channelOptions = computed(() => session.channels.filter((c) => c.key !== 'portal'));
const files = ref<File[]>([]);
const saving = ref(false);
const uploading = ref(false);
const error = ref('');

// Ohne Ablehnen-Status; ohne Auswahl erhält der Vorgang den Status «Neuer Vorgang erhält» des Typs
const statusOptions = computed(() => manualStatusChoices(session.statusesOf(type.value), session.statusTargets[type.value], null));
const startLabel = computed(() => {
  const startId = session.statusTargets[type.value].start;
  return session.statuses.find((s) => s.id === startId)?.label;
});
watch(type, () => (statusId.value = ''));

async function save() {
  error.value = '';
  if (!title.value.trim()) {
    error.value = 'Bitte einen Titel eingeben.';
    return;
  }
  if (!channelId.value) {
    error.value = 'Bitte den Meldeweg wählen.';
    return;
  }
  saving.value = true;
  try {
    const form = new FormData();
    form.append('type', type.value);
    form.append('title', title.value);
    form.append('description', description.value);
    form.append('priority', priority.value);
    if (reporter.value) form.append('reporterId', reporter.value.id);
    if (assigneeId.value) form.append('assigneeId', assigneeId.value);
    if (statusId.value) form.append('statusId', statusId.value);
    form.append('channelId', channelId.value);
    for (const f of files.value) form.append('files', f, f.name);
    const result = await api.post<{ number: number }>('/items', form);
    emit('created', result.number);
  } catch (err) {
    error.value = errorMessage(err);
  } finally {
    saving.value = false;
  }
}
</script>

<template>
  <ModalDialog :title="dialogTitle" wide @close="emit('close')">
    <div v-if="!fixedType" class="field">
      <span class="label">Typ</span>
      <TypeChoice v-model="type" />
    </div>
    <div class="field">
      <label for="new-title">Titel</label>
      <input id="new-title" v-model="title" class="input" maxlength="500" autofocus />
    </div>
    <div class="field">
      <span class="label">Beschreibung</span>
      <MarkdownEditor
        v-model="description"
        v-model:uploading="uploading"
        :min-height="140"
        placeholder="Was ist passiert bzw. was soll gemacht werden?"
        @submit="save"
      />
    </div>
    <div class="grid-2">
      <div class="field">
        <span class="label">Melder</span>
        <UserPicker v-model="reporter" />
      </div>
      <div class="field">
        <label for="new-assignee">Zuständig</label>
        <select id="new-assignee" v-model="assigneeId" class="select">
          <option value="">– niemand –</option>
          <option v-for="u in session.staff" :key="u.id" :value="u.id">{{ u.name }}</option>
        </select>
      </div>
      <div class="field">
        <label for="new-priority">Priorität</label>
        <select id="new-priority" v-model="priority" class="select">
          <option v-for="(label, key) in PRIORITY_LABELS" :key="key" :value="key">{{ label }}</option>
        </select>
      </div>
      <div class="field">
        <label for="new-status">Status</label>
        <select id="new-status" v-model="statusId" class="select">
          <option value="">{{ startLabel ? `Standard («${startLabel}»)` : 'Standard' }}</option>
          <option v-for="s in statusOptions" :key="s.id" :value="s.id">{{ s.label }}</option>
        </select>
      </div>
      <div class="field">
        <label for="new-channel">Meldeweg</label>
        <select id="new-channel" v-model="channelId" class="select" required>
          <option value="" disabled>Bitte wählen …</option>
          <option v-for="c in channelOptions" :key="c.id" :value="c.id">{{ c.label }}</option>
        </select>
      </div>
    </div>
    <div class="field">
      <span class="label">Anhänge</span>
      <FilePicker v-model="files" />
    </div>
    <div v-if="error" class="error-box">{{ error }}</div>
    <template #footer>
      <button class="btn" type="button" @click="emit('close')">Abbrechen</button>
      <button class="btn btn-primary" type="button" :disabled="saving || uploading" @click="save">Erfassen</button>
    </template>
  </ModalDialog>
</template>
