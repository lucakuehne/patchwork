<script setup lang="ts">
import { computed, ref } from 'vue';
import { formatDateTime } from '../format';
import { renderMailHtml, renderMarkdown } from '../markdown';
import type { ItemDetail } from '../types';
import AttachmentList from './AttachmentList.vue';
import MarkdownEditor from './MarkdownEditor.vue';
import OriginalMailDialog from './OriginalMailDialog.vue';

/**
 * Beschreibung bzw. ursprüngliche Meldung eines Vorgangs, weiss hervorgehoben (Antworten blau, Notizen orange).
 * Bei Aufgaben steht sie zuoberst, sonst als ältester Eintrag unter der Timeline.
 */
const props = defineProps<{
  item: ItemDetail;
  label: string;
  busy: boolean;
  save: (description: string) => Promise<unknown>;
}>();

const editing = ref(false);
const draft = ref('');
const uploading = ref(false);
const showOriginal = ref(false);

const html = computed(() => {
  if (props.item.descriptionHtml) return renderMailHtml(props.item.descriptionHtml);
  return props.item.description ? renderMarkdown(props.item.description) : '';
});

function start() {
  draft.value = props.item.description;
  editing.value = true;
}

async function submit() {
  await props.save(draft.value);
  editing.value = false;
}
</script>

<template>
  <section class="original card" :aria-label="label">
    <div class="row original-head">
      <span class="original-label">{{ label }}</span>
      <span class="muted small">
        von <strong>{{ item.creator.name }}</strong> am {{ formatDateTime(item.createdAt) }}
        <template v-if="item.source === 'mail'"> · per Mail</template>
        <template v-else-if="item.source === 'portal'"> · über das Portal</template>
        <template v-if="item.creator.id !== item.reporter.id"> · Melder: {{ item.reporter.name }}</template>
      </span>
      <span v-if="item.simulated" class="badge simulated" title="Im Testbetrieb simuliert, nicht wirklich per Mail eingegangen">
        simuliert
      </span>
      <span class="spacer" />
      <button v-if="item.originalMessageId" class="link-btn small" type="button" @click="showOriginal = true">Originalmail</button>
      <button v-if="!editing" class="btn btn-sm btn-ghost" type="button" @click="start">Bearbeiten</button>
    </div>
    <div v-if="editing" class="stack">
      <MarkdownEditor v-model="draft" v-model:uploading="uploading" :min-height="200" autofocus @submit="submit" />
      <span v-if="item.descriptionHtml" class="faint small">
        Nach dem Speichern wird der Text als Markdown angezeigt, die Formatierung der ursprünglichen Mail entfällt.
      </span>
      <div class="row">
        <button class="btn btn-primary" type="button" :disabled="busy || uploading" @click="submit">Speichern</button>
        <button class="btn" type="button" @click="editing = false">Abbrechen</button>
      </div>
    </div>
    <div v-else-if="html" class="prose" :class="{ 'mail-html': !!item.descriptionHtml }" v-html="html" />
    <div v-else class="faint">Keine Beschreibung</div>
    <AttachmentList :attachments="item.attachments" :text="item.descriptionHtml ? '' : item.description" />
    <OriginalMailDialog
      v-if="showOriginal && item.originalMessageId"
      :number="item.number"
      :message-id="item.originalMessageId"
      @close="showOriginal = false"
    />
  </section>
</template>

<style scoped>
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
.small {
  font-size: 12px;
}
</style>
