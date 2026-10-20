import { defineStore } from 'pinia';
import { computed, ref } from 'vue';
import { api } from '../api';
import { rejectAllowed, transitionAllowed } from '../status-flow';
import type {
  Channel,
  Counts,
  ItemType,
  MailboxOption,
  PublicInfo,
  Status,
  StatusFlow,
  StatusTarget,
  StatusTargetsByType,
  User,
} from '../types';

export const useSession = defineStore('session', () => {
  const info = ref<PublicInfo | null>(null);
  const user = ref<User | null>(null);
  const counts = ref<Counts>({ inbox: 0, incidents: 0, tasks: 0 });
  const statuses = ref<Status[]>([]);
  const statusFlow = ref<StatusFlow>({ restrict: { incident: false, task: false }, transitions: [] });
  /** Ziel-Status je Typ (automatische Wechsel: Start, nach Antwort, Schliessen, Ablehnen, Wartet) */
  const statusTargets = ref<StatusTargetsByType>({ incident: {}, task: {} });
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
    const [list, flow, targets] = await Promise.all([
      api.get<Status[]>('/statuses'),
      api.get<StatusFlow>('/statuses/flow'),
      api.get<StatusTargetsByType>('/statuses/targets'),
    ]);
    statuses.value = list;
    statusFlow.value = flow;
    statusTargets.value = targets;
  }

  /** Darf ein Vorgang dieses Typs von Hand von «fromId» nach «toId» wechseln (Ablauf)? */
  const canMove = (type: ItemType, fromId: string | null, toId: string) =>
    transitionAllowed(statusFlow.value.restrict[type], statusFlow.value.transitions, fromId, toId);

  /** Status-ID eines Ziels (z.B. «reject»), undefined bei leerem freiwilligem Ziel */
  const targetId = (type: ItemType, target: StatusTarget) => statusTargets.value[type][target];

  /** Ist der Status der Ablehnen-Status seines Typs? Er ist nur über «Ablehnen» erreichbar. */
  const isRejectStatus = (status: { id: string; type?: ItemType } | null | undefined, type?: ItemType) => {
    const t = type ?? status?.type;
    return !!status && !!t && statusTargets.value[t].reject === status.id;
  };

  /** Gibt es «Ablehnen» für einen Vorgang dieses Typs im Status «currentId» (Ziel vorhanden, Ablauf)? */
  const canReject = (type: ItemType, currentId: string | null) =>
    rejectAllowed(statusFlow.value.restrict[type], statusFlow.value.transitions, statusTargets.value[type].reject, currentId);

  async function loadStaff() {
    staff.value = await api.get<User[]>('/users/staff');
  }

  async function loadMailboxes() {
    mailboxes.value = await api.get<MailboxOption[]>('/mailboxes');
  }

  /** Status eines Typs in der eingestellten Reihenfolge (= Spalten des Boards) */
  const statusesOf = (type: ItemType) =>
    statuses.value.filter((s) => s.type === type).sort((a, b) => a.position - b.position);

  return {
    info,
    user,
    counts,
    statuses,
    statusFlow,
    statusTargets,
    targetId,
    isRejectStatus,
    canReject,
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
