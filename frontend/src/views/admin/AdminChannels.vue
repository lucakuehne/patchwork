<script setup lang="ts">
import { onMounted, ref } from 'vue';
import draggable from 'vuedraggable';
import { api, errorMessage } from '../../api';
import ChannelIconPicker from '../../components/ChannelIconPicker.vue';
import ModalDialog from '../../components/ModalDialog.vue';
import { useSession } from '../../stores/session';
import { useToast } from '../../stores/toast';
import type { Channel, ChannelIcon } from '../../types';

/** Meldewege pflegen: Bezeichnung, Symbol, Reihenfolge. E-Mail und Portal setzt Patchwork selbst. */
const session = useSession();
const toast = useToast();
const list = ref<Channel[]>([]);
const usage = ref<Record<string, number>>({});
const newLabel = ref('');
const newIcon = ref<ChannelIcon>('other');
const removing = ref<Channel | null>(null);
const replacementId = ref('');
const removeError = ref('');

async function load() {
  try {
    await session.loadChannels();
    usage.value = await api.get<Record<string, number>>('/channels/usage');
    list.value = [...session.channels];
  } catch (err) {
    toast.error(err);
  }
}
onMounted(load);

async function save(channel: Channel, changes: Partial<Pick<Channel, 'label' | 'icon'>>) {
  try {
    await api.patch(`/channels/${channel.id}`, changes);
  } catch (err) {
    toast.error(err);
  }
  await load();
}

function rename(channel: Channel, e: Event) {
  const label = (e.target as HTMLInputElement).value.trim();
  if (label && label !== channel.label) void save(channel, { label });
}

async function reorder() {
  try {
    await api.put('/channels/order', { ids: list.value.map((c) => c.id) });
  } catch (err) {
    toast.error(err);
  }
  await load();
}

async function add() {
  const label = newLabel.value.trim();
  if (!label) return;
  try {
    await api.post('/channels', { label, icon: newIcon.value });
    newLabel.value = '';
    newIcon.value = 'other';
    await load();
  } catch (err) {
    toast.error(err);
  }
}

function askRemove(channel: Channel) {
  removing.value = channel;
  replacementId.value = '';
  removeError.value = '';
}

async function confirmRemove() {
  const channel = removing.value;
  if (!channel) return;
  try {
    await api.delete(`/channels/${channel.id}${replacementId.value ? `?replacementId=${replacementId.value}` : ''}`);
    removing.value = null;
    toast.success('Meldeweg gelöscht');
    await load();
  } catch (err) {
    removeError.value = errorMessage(err);
  }
}
</script>

<template>
  <div class="stack">
    <h1>Meldewege</h1>
    <p class="muted" style="margin: 0">
      Wie ein Vorgang gemeldet wurde. Beim internen Erfassen wählt man ihn aus, in den Listen erscheint das Symbol. «E-Mail» und
      «Portal» setzt Patchwork selbst. Die Reihenfolge lässt sich per Ziehen ändern.
    </p>
    <div class="card card-body stack">
      <draggable v-model="list" item-key="id" handle=".handle" class="list" :animation="120" @end="reorder">
        <template #item="{ element }">
          <div class="channel-row">
            <span class="handle" title="Ziehen zum Sortieren">⋮⋮</span>
            <ChannelIconPicker :model-value="element.icon" @update:model-value="save(element, { icon: $event })" />
            <input class="input label-input" :value="element.label" maxlength="60" @change="rename(element, $event)" />
            <span class="faint auto" :title="element.key ? 'Setzt Patchwork bei Mails bzw. Meldungen im Portal selbst' : undefined">
              {{ element.key ? 'automatisch' : '' }}
            </span>
            <span class="faint usage" title="Vorgänge mit diesem Meldeweg">{{ usage[element.id] ?? 0 }}</span>
            <button
              class="btn btn-sm btn-ghost btn-danger"
              type="button"
              :disabled="!!element.key"
              :title="element.key ? 'Setzt Patchwork selbst, lässt sich nicht löschen' : `${element.label} löschen`"
              :aria-label="`${element.label} löschen`"
              @click="askRemove(element)"
            >
              ✕
            </button>
          </div>
        </template>
      </draggable>
      <form class="channel-row add-row" @submit.prevent="add">
        <span class="handle" />
        <ChannelIconPicker v-model="newIcon" />
        <input v-model="newLabel" class="input label-input" placeholder="Meldeweg hinzufügen" maxlength="60" />
        <span class="auto" />
        <span class="usage" />
        <button class="btn btn-sm" type="submit" :disabled="!newLabel.trim()">+</button>
      </form>
    </div>

    <ModalDialog v-if="removing" :title="`Meldeweg «${removing.label}» löschen`" @close="removing = null">
      <p v-if="(usage[removing.id] ?? 0) > 0" style="margin: 0">
        {{ usage[removing.id] }} Vorgänge haben diesen Meldeweg. Welchen sollen sie stattdessen erhalten?
      </p>
      <p v-else style="margin: 0">Der Meldeweg wird von keinem Vorgang verwendet.</p>
      <select v-if="(usage[removing.id] ?? 0) > 0" v-model="replacementId" class="select">
        <option value="" disabled>Ersatz wählen</option>
        <option v-for="c in list.filter((x) => x.id !== removing!.id)" :key="c.id" :value="c.id">{{ c.label }}</option>
      </select>
      <div v-if="removeError" class="error-box">{{ removeError }}</div>
      <template #footer>
        <button class="btn" type="button" @click="removing = null">Abbrechen</button>
        <button class="btn btn-danger" type="button" :disabled="(usage[removing.id] ?? 0) > 0 && !replacementId" @click="confirmRemove">
          Löschen
        </button>
      </template>
    </ModalDialog>
  </div>
</template>

<style scoped>
.list {
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.channel-row {
  display: flex;
  align-items: center;
  gap: 8px;
  max-width: 560px;
}
.handle {
  width: 16px;
  flex-shrink: 0;
  cursor: grab;
  color: var(--text-faint);
  user-select: none;
}
.add-row .handle {
  cursor: default;
}
.label-input {
  flex: 1;
  min-width: 0;
}
.auto {
  width: 70px;
  flex-shrink: 0;
  font-size: 12px;
}
.usage {
  width: 28px;
  text-align: right;
  font-size: 12px;
}
</style>
