<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { api, errorMessage } from '../api';
import { useDebounced } from '../composables';
import { formatSize, itemRef } from '../format';
import { useSession } from '../stores/session';
import type { IncomingMail, ItemSummary, OutgoingMailDetail, SimulationDraft } from '../types';
import FilePicker from './FilePicker.vue';
import ModalDialog from './ModalDialog.vue';

/**
 * Testbetrieb: eine eingehende Mail simulieren, als Antwort auf eine Mail von Patchwork («reply») oder als neue Mail an
 * ein Postfach. «original»: vorbelegt aus einer echten Mail (Absender, Postfach, Betreff, Text, Anhänge), z.B. um eine
 * im Eingang gelandete Antwort auf ein HelpSpot-Ticket als Antwort auf einen Vorgang durchzuspielen.
 * Patchwork verarbeitet die Mail wie eine echte, sie landet aber nicht im Postfach.
 */
const props = defineProps<{
  reply?: OutgoingMailDetail;
  mailboxes?: { id: string; name: string; address: string }[];
  original?: SimulationDraft;
}>();
const emit = defineEmits<{ close: []; done: [mail: IncomingMail] }>();
const session = useSession();

const OTHER = '__andere__';
const recipients = computed(() => (props.reply ? [...new Set([...props.reply.to, ...props.reply.cc])] : []));
const mailboxOptions = computed(() => props.mailboxes ?? session.mailboxes);
const sender = ref(recipients.value[0] ?? OTHER);
const address = ref(props.original?.from ?? '');
const name = ref(props.original?.name ?? '');
const mailboxId = ref(
  mailboxOptions.value.find((m) => m.id === props.original?.mailboxId)?.id ?? mailboxOptions.value[0]?.id ?? '',
);
const subject = ref(props.original?.subject ?? '');
const text = ref(props.original?.text ?? '');
const automated = ref(false);
const files = ref<File[]>([]);
/** Anhänge der echten Mail, die mitgehen (anfangs alle) */
const keptAttachments = ref<number[]>(props.original?.attachments.map((a) => a.index) ?? []);
const discardOriginal = ref(!!props.original?.discardable);
const sending = ref(false);
const error = ref('');

const freeAddress = computed(() => !props.reply || sender.value === OTHER);

// Antwort auf einen Vorgang (nur bei neuen Mails): Suche nach Nummer oder Text
const replyItem = ref<Pick<ItemSummary, 'prefix' | 'number' | 'title'> | null>(null);
const itemQuery = ref('');
const debouncedQuery = useDebounced(itemQuery, 250);
const itemResults = ref<ItemSummary[]>([]);
watch(debouncedQuery, async (q) => {
  if (!q.trim()) {
    itemResults.value = [];
    return;
  }
  try {
    itemResults.value = (await api.get<{ items: ItemSummary[] }>(`/items?view=search&q=${encodeURIComponent(q.trim())}&limit=8`)).items;
  } catch (err) {
    error.value = errorMessage(err);
  }
});
function chooseItem(item: ItemSummary) {
  replyItem.value = { prefix: item.prefix, number: item.number, title: item.title };
  itemQuery.value = '';
  itemResults.value = [];
}

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
    if (!props.reply && replyItem.value) form.append('replyToItem', itemRef(replyItem.value));
    form.append('text', text.value);
    form.append('automated', String(automated.value));
    if (props.original) {
      form.append('originalId', props.original.incomingMailId);
      form.append('originalAttachments', [...keptAttachments.value].sort((a, b) => a - b).join(','));
      form.append('discardOriginal', String(discardOriginal.value && !!props.original.discardable));
    }
    for (const f of files.value) form.append('files', f, f.name);
    emit('done', await api.post<IncomingMail>('/admin/incoming-mails/simulate', form));
  } catch (err) {
    error.value = errorMessage(err);
  } finally {
    sending.value = false;
  }
}

const title = computed(() => (props.reply ? 'Antwort simulieren' : props.original ? 'Als simulierte Mail' : 'Neue Mail simulieren'));
</script>

<template>
  <ModalDialog :title="title" wide @close="emit('close')">
    <p class="muted hint">
      Patchwork verarbeitet die Mail wie eine echte: Zuordnung, Regeln und Benachrichtigungen (für diese gilt der Testbetrieb).
      Sie landet nicht im Postfach und erscheint in der Timeline mit «simuliert».
    </p>
    <p v-if="reply" class="muted hint">
      Antwort auf «{{ reply.subject }}»<template v-if="reply.item"> ({{ itemRef(reply.item) }})</template>. Die ursprüngliche Mail wird darunter zitiert wie in
      Outlook.
    </p>
    <p v-if="original" class="muted hint">Vorbelegt aus der echten Mail «{{ original.subject }}»; alles lässt sich ändern.</p>
    <div class="grid-2">
      <div v-if="reply" class="field">
        <label for="sim-sender">Absender</label>
        <select id="sim-sender" v-model="sender" class="select">
          <option v-for="r in recipients" :key="r" :value="r">{{ r }}</option>
          <option :value="OTHER">Andere Adresse …</option>
        </select>
      </div>
      <div v-else-if="mailboxOptions.length > 1" class="field">
        <label for="sim-mailbox">An Postfach</label>
        <select id="sim-mailbox" v-model="mailboxId" class="select">
          <option v-for="m in mailboxOptions" :key="m.id" :value="m.id">{{ m.name }} ({{ m.address }})</option>
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
    <div v-if="!reply" class="field">
      <label for="sim-item">Antwort auf Vorgang (optional)</label>
      <div v-if="replyItem" class="chosen">
        <span>
          <span class="mono">{{ itemRef(replyItem) }}</span> {{ replyItem.title }}
        </span>
        <button class="link-btn" type="button" aria-label="Vorgang entfernen" @click="replyItem = null">✕</button>
      </div>
      <template v-else>
        <input id="sim-item" v-model="itemQuery" class="input" placeholder="Nummer oder Text suchen" autocomplete="off" />
        <div v-if="itemResults.length" class="results">
          <button v-for="i in itemResults" :key="i.id" type="button" class="result" @click="chooseItem(i)">
            <span class="mono">{{ itemRef(i) }}</span> {{ i.title }}
          </button>
        </div>
      </template>
      <span class="faint small">Setzt die Kennung (z.B. [PW-…]) in den Betreff und verweist auf die letzte Mail des Vorgangs.</span>
    </div>
    <div class="field">
      <label for="sim-text">Text</label>
      <textarea id="sim-text" v-model="text" class="textarea" rows="7" />
    </div>
    <div v-if="original?.attachments.length" class="field">
      <span class="label">Anhänge der echten Mail</span>
      <label v-for="a in original.attachments" :key="a.index" class="checkbox">
        <input v-model="keptAttachments" type="checkbox" :value="a.index" />
        {{ a.filename }} <span class="faint">({{ formatSize(a.size) }})</span>
      </label>
    </div>
    <FilePicker v-model="files" compact />
    <label v-if="reply" class="checkbox">
      <input v-model="automated" type="checkbox" />
      Als Abwesenheitsnotiz (automatische Antwort)
    </label>
    <label v-if="original?.discardable" class="checkbox">
      <input v-model="discardOriginal" type="checkbox" />
      Original verwerfen ({{ itemRef(original.discardable) }} im Eingang, lässt sich wiederherstellen)
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
.small {
  font-size: 12px;
}
.chosen {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 10px;
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  background: var(--surface-2);
}
.chosen > span {
  flex: 1;
  min-width: 0;
  overflow-wrap: anywhere;
}
.results {
  display: flex;
  flex-direction: column;
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  max-height: 220px;
  overflow-y: auto;
}
.result {
  padding: 6px 10px;
  border: none;
  border-bottom: 1px solid var(--border);
  background: var(--surface);
  color: var(--text);
  font: inherit;
  text-align: left;
  cursor: pointer;
}
.result:last-child {
  border-bottom: none;
}
.result:hover {
  background: var(--surface-hover);
}
</style>
