<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { api, errorMessage } from '../api';
import { formatDateTime } from '../format';
import { incomingResultText } from '../incoming';
import { itemRef, type ItemKey } from '../item-ref';
import { renderMailHtml } from '../markdown';
import { useSession } from '../stores/session';
import { useToast } from '../stores/toast';
import type { IncomingMail, MailView, SimulationDraft } from '../types';
import MailAttachmentList from './MailAttachmentList.vue';
import ModalDialog from './ModalDialog.vue';
import SimulateMailDialog from './SimulateMailDialog.vue';

/**
 * Originalmail einer eingehenden Nachricht ansehen; die .eml-Datei lässt sich von hier herunterladen. Im Testbetrieb
 * erzeugen Admins daraus eine simulierte Mail («simulated» nach dem Simulieren, z.B. um den Vorgang neu zu laden).
 */
const props = defineProps<{ itemKey: ItemKey; messageId: string }>();
/** Kennung des Vorgangs in den Adressen, z.B. «PW-12» */
const itemPath = itemRef(props.itemKey);
const emit = defineEmits<{ close: []; simulated: [] }>();
const session = useSession();
const toast = useToast();

const mail = ref<MailView | null>(null);
const error = ref('');
const query = `?messageId=${encodeURIComponent(props.messageId)}`;
const canSimulate = computed(() => session.isAdmin && !!session.info?.testMode);
const draft = ref<SimulationDraft | null>(null);

onMounted(async () => {
  try {
    mail.value = await api.get<MailView>(`/items/${itemPath}/original/view${query}`);
  } catch (err) {
    error.value = errorMessage(err);
  }
});

async function simulate() {
  try {
    draft.value = await api.get<SimulationDraft>(`/admin/incoming-mails/draft${query}`);
  } catch (err) {
    toast.error(err);
  }
}

function simulated(result: IncomingMail) {
  draft.value = null;
  if (result.result === 'failed') toast.error(`Simulierte Mail: ${incomingResultText(result)}`);
  else toast.success(`Simulierte Mail: ${incomingResultText(result)}`);
  emit('simulated');
  emit('close');
}
</script>

<template>
  <ModalDialog v-if="!draft" :title="mail?.headers.subject || 'Originalmail'" wide @close="emit('close')">
    <div v-if="error" class="error-box">{{ error }}</div>
    <div v-else-if="!mail" class="faint">Lädt …</div>
    <template v-else>
      <dl class="headers">
        <dt>Von</dt>
        <dd>{{ mail.headers.from || '–' }}</dd>
        <dt>An</dt>
        <dd>{{ mail.headers.to.join(', ') || '–' }}</dd>
        <template v-if="mail.headers.cc.length">
          <dt>CC</dt>
          <dd>{{ mail.headers.cc.join(', ') }}</dd>
        </template>
        <template v-if="mail.headers.date">
          <dt>Datum</dt>
          <dd>{{ formatDateTime(mail.headers.date) }}</dd>
        </template>
      </dl>
      <div v-if="mail.html" class="prose mail-html mail-body" v-html="renderMailHtml(mail.html)" />
      <pre v-else class="mail-body mail-text">{{ mail.text }}</pre>
      <MailAttachmentList
        :attachments="mail.attachments"
        :path="(index) => `/api/items/${itemPath}/original/attachments/${index}`"
        :query="query"
      />
    </template>
    <template #footer>
      <a class="btn" :href="`/api/items/${itemPath}/original${query}`">Als .eml herunterladen</a>
      <button v-if="canSimulate && mail" class="btn" type="button" @click="simulate">Als simulierte Mail …</button>
      <button class="btn btn-primary" type="button" @click="emit('close')">Schliessen</button>
    </template>
  </ModalDialog>
  <SimulateMailDialog v-else :original="draft" @close="draft = null" @done="simulated" />
</template>

<style scoped>
.headers {
  display: grid;
  grid-template-columns: max-content 1fr;
  gap: 4px 12px;
  margin: 0;
}
.headers dt {
  color: var(--text-muted);
}
.headers dd {
  margin: 0;
  overflow-wrap: anywhere;
}
.mail-body {
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  padding: 12px;
  max-height: 60vh;
  overflow: auto;
}
.mail-text {
  margin: 0;
  white-space: pre-wrap;
  font-family: var(--font);
}
</style>
