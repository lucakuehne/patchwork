<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { api, errorMessage } from '../../api';
import AttachmentList from '../../components/AttachmentList.vue';
import FilePicker from '../../components/FilePicker.vue';
import MarkdownEditor from '../../components/MarkdownEditor.vue';
import { formatDateTime, initials, itemRef } from '../../format';
import type { ItemKey } from '../../item-ref';
import { renderMailHtml, renderMarkdown } from '../../markdown';
import { useSession } from '../../stores/session';
import { useToast } from '../../stores/toast';
import type { PortalItemDetail } from '../../types';
import PortalStatusBadge from './PortalStatusBadge.vue';

/** «itemKey» null: ungültige Kennung in der Adresse */
const props = defineProps<{ itemKey: ItemKey | null }>();
const refText = computed(() => (props.itemKey ? itemRef(props.itemKey) : ''));
const session = useSession();
const toast = useToast();

const item = ref<PortalItemDetail | null>(null);
const notFound = ref(false);
const body = ref('');
const files = ref<File[]>([]);
const sending = ref(false);
const uploading = ref(false);
const error = ref('');

async function load() {
  if (!refText.value) {
    notFound.value = true;
    return;
  }
  try {
    item.value = await api.get<PortalItemDetail>(`/portal/items/${refText.value}`);
    notFound.value = false;
    document.title = `${refText.value} ${item.value.title} – ${session.appName}`;
  } catch (err) {
    if ((err as { status?: number }).status === 404) notFound.value = true;
    else toast.error(err);
  }
}
watch(refText, load, { immediate: true });

const entriesNewestFirst = computed(() => (item.value ? [...item.value.entries].reverse() : []));
const descriptionHtml = computed(() => {
  if (!item.value) return '';
  if (item.value.descriptionHtml) return renderMailHtml(item.value.descriptionHtml);
  return item.value.description ? renderMarkdown(item.value.description, 'portal') : '';
});
const entryHtml = (e: PortalItemDetail['entries'][number]) =>
  e.bodyHtml ? renderMailHtml(e.bodyHtml) : renderMarkdown(e.body, 'portal');

async function send() {
  if ((!body.value.trim() && files.value.length === 0) || uploading.value) return;
  sending.value = true;
  error.value = '';
  try {
    const form = new FormData();
    form.append('body', body.value);
    for (const f of files.value) form.append('files', f, f.name);
    await api.post(`/portal/items/${refText.value}/replies`, form);
    body.value = '';
    files.value = [];
    toast.success('Deine Antwort wurde gesendet.');
    await load();
  } catch (err) {
    error.value = errorMessage(err);
  } finally {
    sending.value = false;
  }
}
</script>

<template>
  <div v-if="notFound" class="card empty">Meldung {{ refText }} wurde nicht gefunden.</div>

  <div v-else-if="item" class="stack">
    <RouterLink to="/portal" class="back">← Meine Vorgänge</RouterLink>
    <div class="row">
      <span class="mono muted">{{ itemRef(item) }}</span>
      <PortalStatusBadge :status="item.status" />
    </div>
    <h1 class="title">{{ item.title }}</h1>

    <div v-if="item.duplicateOf" class="card duplicate">
      Diese Meldung betrifft dasselbe wie
      <RouterLink v-if="item.duplicateOf.accessible" :to="`/portal/items/${itemRef(item.duplicateOf)}`">
        {{ itemRef(item.duplicateOf) }} «{{ item.duplicateOf.title }}»
      </RouterLink>
      <template v-else>{{ itemRef(item.duplicateOf) }} «{{ item.duplicateOf.title }}»</template>
      und wird dort weiterbearbeitet.
      <template v-if="!item.duplicateOf.accessible">Du erhältst die Updates per Mail.</template>
    </div>

    <div v-else class="card composer">
      <div class="label">Nachricht an die IT</div>
      <MarkdownEditor
        v-model="body"
        v-model:uploading="uploading"
        context="portal"
        :min-height="100"
        placeholder="Ergänzung oder Antwort …"
        @submit="send"
      />
      <FilePicker v-model="files" compact />
      <div v-if="error" class="error-box">{{ error }}</div>
      <div class="row">
        <span class="faint small">Ctrl+Enter sendet</span>
        <div class="spacer" />
        <button
          class="btn btn-primary"
          type="button"
          :disabled="sending || uploading || (!body.trim() && !files.length)"
          @click="send"
        >
          Senden
        </button>
      </div>
    </div>

    <div class="timeline">
      <div v-for="e in entriesNewestFirst" :key="e.id" class="card message" :class="{ own: e.own, rejected: e.kind === 'rejected' }">
        <div class="msg-head">
          <span class="avatar">{{ e.own ? initials(session.user?.name ?? '') : 'IT' }}</span>
          <strong>{{ e.kind === 'rejected' ? 'Abgelehnt' : e.author }}</strong>
          <span v-if="e.simulated" class="badge simulated" title="Im Testbetrieb simuliert">simuliert</span>
          <span class="spacer" />
          <span class="faint small">{{ formatDateTime(e.createdAt) }}</span>
        </div>
        <div v-if="e.kind === 'rejected'" class="faint small">Begründung:</div>
        <div class="prose" :class="{ 'mail-html': !!e.bodyHtml }" v-html="entryHtml(e)" />
        <AttachmentList :attachments="e.attachments" base="/api/portal/attachments" :text="e.body" :html="e.bodyHtml" />
      </div>
    </div>

    <section class="card original">
      <div class="row original-head">
        <span class="original-label">Deine Meldung</span>
        <span class="muted small">vom {{ formatDateTime(item.createdAt) }}</span>
        <span v-if="item.simulated" class="badge simulated" title="Im Testbetrieb simuliert">simuliert</span>
      </div>
      <div v-if="descriptionHtml" class="prose" :class="{ 'mail-html': !!item.descriptionHtml }" v-html="descriptionHtml" />
      <div v-else class="faint">Keine Beschreibung</div>
      <AttachmentList
        :attachments="item.attachments"
        base="/api/portal/attachments"
        :text="item.description"
        :html="item.descriptionHtml"
      />
    </section>
  </div>
</template>

<style scoped>
.back {
  font-size: 13px;
}
.title {
  font-size: 22px;
  overflow-wrap: anywhere;
}
.small {
  font-size: 12px;
}
.composer {
  padding: 12px;
  display: flex;
  flex-direction: column;
  gap: 10px;
}
.duplicate {
  padding: 12px 14px;
  background: var(--surface-2);
}
.timeline {
  display: flex;
  flex-direction: column;
  gap: 10px;
}
/* Öffentliche Nachrichten blau wie in der IT-Ansicht */
.message {
  padding: 12px 14px;
  background: var(--reply-bg);
  border-color: var(--reply-border);
  border-left: 3px solid var(--reply-accent);
}
.message.rejected {
  background: var(--surface);
  border-color: var(--border);
  border-left: 4px solid var(--danger);
}
.msg-head {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 8px;
}
/* Ursprüngliche Meldung weiss */
.original {
  padding: 14px 16px;
  background: var(--original-bg);
  border-color: var(--original-border);
}
.original-head {
  flex-wrap: wrap;
  margin-bottom: 10px;
}
.original-label {
  font-size: 12px;
  font-weight: 700;
  color: var(--text-muted);
  text-transform: uppercase;
  letter-spacing: 0.03em;
}
</style>
