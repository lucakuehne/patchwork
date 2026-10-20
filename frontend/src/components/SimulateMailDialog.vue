<script setup lang="ts">
import { computed, ref } from 'vue';
import { api, errorMessage } from '../api';
import { itemRef } from '../format';
import type { IncomingMail, OutgoingMailDetail } from '../types';
import FilePicker from './FilePicker.vue';
import ModalDialog from './ModalDialog.vue';

/**
 * Testbetrieb: eine eingehende Mail simulieren, als Antwort auf eine Mail von Patchwork («reply») oder als neue Mail an
 * ein Postfach («mailboxes»). Patchwork verarbeitet sie wie eine echte, sie landet aber nicht im Postfach.
 */
const props = defineProps<{ reply?: OutgoingMailDetail; mailboxes?: { id: string; name: string; address: string }[] }>();
const emit = defineEmits<{ close: []; done: [mail: IncomingMail] }>();

const OTHER = '__andere__';
const recipients = computed(() => (props.reply ? [...new Set([...props.reply.to, ...props.reply.cc])] : []));
const sender = ref(recipients.value[0] ?? OTHER);
const address = ref('');
const name = ref('');
const mailboxId = ref(props.mailboxes?.[0]?.id ?? '');
const subject = ref('');
const text = ref('');
const automated = ref(false);
const files = ref<File[]>([]);
const sending = ref(false);
const error = ref('');

const freeAddress = computed(() => !props.reply || sender.value === OTHER);

async function submit() {
  error.value = '';
  const from = freeAddress.value ? address.value.trim() : sender.value;
  if (!from) {
    error.value = 'Bitte einen Absender angeben.';
    return;
  }
  if (!props.reply && !subject.value.trim()) {
    error.value = 'Bitte einen Betreff angeben.';
    return;
  }
  sending.value = true;
  try {
    const form = new FormData();
    if (props.reply) form.append('replyTo', props.reply.id);
    else form.append('mailboxId', mailboxId.value);
    form.append('from', from);
    if (freeAddress.value && name.value.trim()) form.append('name', name.value.trim());
    if (!props.reply) form.append('subject', subject.value);
    form.append('text', text.value);
    form.append('automated', String(automated.value));
    for (const f of files.value) form.append('files', f, f.name);
    emit('done', await api.post<IncomingMail>('/admin/incoming-mails/simulate', form));
  } catch (err) {
    error.value = errorMessage(err);
  } finally {
    sending.value = false;
  }
}
</script>

<template>
  <ModalDialog :title="reply ? 'Antwort simulieren' : 'Neue Mail simulieren'" wide @close="emit('close')">
    <p class="muted hint">
      Patchwork verarbeitet die Mail wie eine echte: Zuordnung, Regeln und Benachrichtigungen (für diese gilt der Testbetrieb).
      Sie landet nicht im Postfach und erscheint in der Timeline mit «simuliert».
    </p>
    <p v-if="reply" class="muted hint">
      Antwort auf «{{ reply.subject }}» ({{ itemRef(reply.item.number) }}). Die ursprüngliche Mail wird darunter zitiert wie in
      Outlook.
    </p>
    <div class="grid-2">
      <div v-if="reply" class="field">
        <label for="sim-sender">Absender</label>
        <select id="sim-sender" v-model="sender" class="select">
          <option v-for="r in recipients" :key="r" :value="r">{{ r }}</option>
          <option :value="OTHER">Andere Adresse …</option>
        </select>
      </div>
      <div v-else-if="mailboxes && mailboxes.length > 1" class="field">
        <label for="sim-mailbox">An Postfach</label>
        <select id="sim-mailbox" v-model="mailboxId" class="select">
          <option v-for="m in mailboxes" :key="m.id" :value="m.id">{{ m.name }} ({{ m.address }})</option>
        </select>
      </div>
    </div>
    <div v-if="freeAddress" class="grid-2">
      <div class="field">
        <label for="sim-address">{{ reply ? 'Adresse' : 'Absender' }}</label>
        <input id="sim-address" v-model="address" class="input" type="email" placeholder="name@firma.ch" />
      </div>
      <div class="field">
        <label for="sim-name">Name (optional)</label>
        <input id="sim-name" v-model="name" class="input" placeholder="z.B. Anna Muster" />
      </div>
    </div>
    <div v-if="!reply" class="field">
      <label for="sim-subject">Betreff</label>
      <input id="sim-subject" v-model="subject" class="input" maxlength="500" />
    </div>
    <div class="field">
      <label for="sim-text">Text</label>
      <textarea id="sim-text" v-model="text" class="textarea" rows="7" />
    </div>
    <FilePicker v-model="files" compact />
    <label v-if="reply" class="checkbox">
      <input v-model="automated" type="checkbox" />
      Als Abwesenheitsnotiz (automatische Antwort)
    </label>
    <div v-if="error" class="error-box">{{ error }}</div>
    <template #footer>
      <button class="btn" type="button" @click="emit('close')">Abbrechen</button>
      <button class="btn btn-primary" type="button" :disabled="sending" @click="submit">Simulieren</button>
    </template>
  </ModalDialog>
</template>

<style scoped>
.hint {
  margin: 0;
  font-size: 13px;
}
</style>
