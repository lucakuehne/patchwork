import { defineStore } from 'pinia';
import { computed, ref } from 'vue';
import { api } from '../api';
import { CATEGORY_ORDER } from '../format';
import { transitionAllowed } from '../status-flow';
import type { Channel, Counts, ItemType, MailboxOption, PublicInfo, Status, StatusFlow, User } from '../types';

export const useSession = defineStore('session', () => {
  const info = ref<PublicInfo | null>(null);
  const user = ref<User | null>(null);
  const counts = ref<Counts>({ inbox: 0, incidents: 0, tasks: 0 });
  const statuses = ref<Status[]>([]);
  const statusFlow = ref<StatusFlow>({ restrict: { incident: false, task: false }, transitions: [] });
  const channels = ref<Channel[]>([]);
  const staff = ref<User[]>([]);
  const mailboxes = ref<MailboxOption[]>([]);

  const isAdmin = computed(() => user.value?.role === 'admin');
  /** Admin und IT nutzen die Oberfläche, Standard-Benutzer das Portal */
  const isStaff = computed(() => user.value?.role === 'admin' || user.value?.role === 'it');
  const appName = computed(() => info.value?.appName ?? 'Patchwork');
  const logoUrl = computed(() =>
    info.value?.hasLogo ? `/api/public/logo?v=${info.value.logoVersion ?? ''}` : null,
  );

  async function loadInfo() {
    info.value = await api.get<PublicInfo>('/public/info');
    document.title = info.value.appName;
  }

  async function loadMe() {
    user.value = (await api.get<{ user: User | null }>('/auth/me')).user;
  }

  async function login(username: string, password: string) {
    user.value = await api.post<User>('/auth/login', { username, password });
    if (isStaff.value) await loadAppData();
  }

  async function logout() {
    await api.post('/auth/logout');
    user.value = null;
  }

  /** Stammdaten nach dem Login. */
  async function loadAppData() {
    await Promise.all([refreshCounts(), loadStatuses(), loadChannels(), loadStaff(), loadMailboxes()]);
  }

  async function loadChannels() {
    channels.value = await api.get<Channel[]>('/channels');
  }

  /** Meldeweg nach ID, z.B. für Listen (dort steht nur die ID) */
  const channelById = (id: string | null | undefined) => (id ? channels.value.find((c) => c.id === id) : undefined);

  async function refreshCounts() {
    counts.value = await api.get<Counts>('/items/counts');
  }

  async function loadStatuses() {
    const [list, flow] = await Promise.all([api.get<Status[]>('/statuses'), api.get<StatusFlow>('/statuses/flow')]);
    statuses.value = list;
    statusFlow.value = flow;
  }

  /** Darf ein Vorgang dieses Typs von Hand von «fromId» nach «toId» wechseln (Ablauf)? */
  const canMove = (type: ItemType, fromId: string | null, toId: string) =>
    transitionAllowed(statusFlow.value.restrict[type], statusFlow.value.transitions, fromId, toId);

  async function loadStaff() {
    staff.value = await api.get<User[]>('/users/staff');
  }

  async function loadMailboxes() {
    mailboxes.value = await api.get<MailboxOption[]>('/mailboxes');
  }

  /** Status eines Typs, gruppiert nach Kategorie und innerhalb nach Reihenfolge. */
  const statusesOf = (type: ItemType) =>
    statuses.value
      .filter((s) => s.type === type)
      .sort(
        (a, b) =>
          CATEGORY_ORDER.indexOf(a.category) - CATEGORY_ORDER.indexOf(b.category) || a.position - b.position,
      );

  return {
    info,
    user,
    counts,
    statuses,
    statusFlow,
    channels,
    staff,
    mailboxes,
    isAdmin,
    isStaff,
    appName,
    logoUrl,
    loadInfo,
    loadMe,
    login,
    logout,
    loadAppData,
    refreshCounts,
    loadStatuses,
    loadChannels,
    loadStaff,
    loadMailboxes,
    statusesOf,
    canMove,
    channelById,
  };
});
