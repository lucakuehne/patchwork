<script setup lang="ts">
import { onMounted, ref } from 'vue';
import { api } from '../../api';
import ModalDialog from '../../components/ModalDialog.vue';
import { formatDateTime, formatSize, itemRef } from '../../format';
import { renderMailHtml } from '../../markdown';
import { useSession } from '../../stores/session';
import { useToast } from '../../stores/toast';
import type { HeldMail, HeldMailDetail } from '../../types';

/** Im Testbetrieb zurückgehaltene Mails: was versendet worden wäre. */
const session = useSession();
const toast = useToast();
const mails = ref<HeldMail[]>([]);
const loading = ref(true);
const open = ref<HeldMailDetail | null>(null);

onMounted(async () => {
  try {
    mails.value = await api.get<HeldMail[]>('/admin/held-mails');
  } catch (err) {
    toast.error(err);
  } finally {
    loading.value = false;
  }
});

async function show(m: HeldMail) {
  try {
    open.value = await api.get<HeldMailDetail>(`/admin/held-mails/${m.id}`);
  } catch (err) {
    toast.error(err);
  }
}

const kind = (m: HeldMail) => (m.reply ? 'Antwort' : 'Automatisch');
const recipients = (m: HeldMail) => [...m.to, ...m.cc.map((c) => `CC ${c}`)].join(', ');
</script>

<template>
  <div class="stack">
    <h1>Nicht versendete Mails</h1>
    <p class="muted" style="margin: 0">
      Im Testbetrieb stellt Patchwork alle Mails wie gewohnt zusammen, versendet sie aber nicht. Hier steht, was versendet worden
      wäre. Der Testbetrieb ist zurzeit <strong>{{ session.info?.testMode ? 'eingeschaltet' : 'ausgeschaltet' }}</strong>
      (umschalten unter <RouterLink to="/admin/allgemein">Allgemein</RouterLink>). Beim Ausschalten werden diese Mails nicht
      nachträglich versendet.
    </p>
    <div class="card table-wrap">
      <table class="table">
        <thead>
          <tr>
            <th>Zeit</th>
            <th>An</th>
            <th>Betreff</th>
            <th>Vorgang</th>
            <th>Art</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="m in mails" :key="m.id" class="clickable" @click="show(m)">
            <td class="nowrap muted">{{ formatDateTime(m.createdAt) }}</td>
            <td>{{ recipients(m) }}</td>
            <td>{{ m.subject }}</td>
            <td class="nowrap">
              <RouterLink :to="`/v/${m.item.number}`" :title="m.item.title" @click.stop>{{ itemRef(m.item.number) }}</RouterLink>
            </td>
            <td><span class="badge">{{ kind(m) }}</span></td>
          </tr>
        </tbody>
      </table>
      <div v-if="!loading && !mails.length" class="empty">Keine nicht versendeten Mails.</div>
    </div>

    <ModalDialog v-if="open" :title="open.subject" wide @close="open = null">
      <dl class="headers">
        <dt>Von</dt>
        <dd>{{ open.fromAddress }}</dd>
        <dt>An</dt>
        <dd>{{ open.to.join(', ') || '–' }}</dd>
        <template v-if="open.cc.length">
          <dt>CC</dt>
          <dd>{{ open.cc.join(', ') }}</dd>
        </template>
        <dt>Zeit</dt>
        <dd>{{ formatDateTime(open.createdAt) }}</dd>
        <dt>Vorgang</dt>
        <dd>
          <RouterLink :to="`/v/${open.item.number}`">{{ itemRef(open.item.number) }} {{ open.item.title }}</RouterLink>
        </dd>
      </dl>
      <div v-if="open.html" class="prose mail-html mail-body" v-html="renderMailHtml(open.html)" />
      <pre v-else class="mail-body mail-text">{{ open.text }}</pre>
      <div v-if="open.attachments.length" class="stack attachments">
        <h3>Anhänge</h3>
        <a v-for="a in open.attachments" :key="a.index" :href="`/api/admin/held-mails/${open.id}/attachments/${a.index}`">
          {{ a.filename }} <span class="faint">({{ formatSize(a.size) }})</span>
        </a>
      </div>
      <template #footer>
        <a class="btn" :href="`/api/admin/held-mails/${open.id}/eml`">Als .eml herunterladen</a>
        <button class="btn btn-primary" type="button" @click="open = null">Schliessen</button>
      </template>
    </ModalDialog>
  </div>
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
  max-height: 50vh;
  overflow: auto;
}
.mail-text {
  margin: 0;
  white-space: pre-wrap;
  font-family: var(--font);
}
.attachments {
  gap: 4px;
}
</style>
