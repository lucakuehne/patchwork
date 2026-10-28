import { defineStore } from 'pinia';
import { computed, ref } from 'vue';
import { api } from '../api';
import { rejectAllowed, transitionAllowed } from '../status-flow';
import { applyTheme } from '../theme';
import type {
  Area,
  Channel,
  ChannelDefaults,
  Counts,
  ItemType,
  MailboxOption,
  Preferences,
  PublicInfo,
  Status,
  StatusFlow,
  StatusTarget,
  StatusTargetsByType,
  User,
} from '../types';

/** Startseite je Bereich */
export const AREA_ROUTES: Record<Area, string> = { inbox: 'inbox', incident: 'incidents', task: 'tasks' };

export const useSession = defineStore('session', () => {
  const info = ref<PublicInfo | null>(null);
  const user = ref<User | null>(null);
  /** «Als dieser Benutzer arbeiten»: der Admin dahinter (sonst null); alles läuft mit den Rechten von «user» */
  const impersonator = ref<User | null>(null);
  const counts = ref<Counts>({ inbox: 0, incidents: 0, tasks: 0 });
  const statuses = ref<Status[]>([]);
  const statusFlow = ref<StatusFlow>({ restrict: { incident: false, task: false }, transitions: [] });
  /** Ziel-Status je Typ (automatische Wechsel: Start, nach Antwort, Schliessen, Ablehnen, Wartet) */
  const statusTargets = ref<StatusTargetsByType>({ incident: {}, task: {} });
  const channels = ref<Channel[]>([]);
  /** Vorbelegter Meldeweg beim internen Erfassen je Typ */
  const channelDefaults = ref<ChannelDefaults>({ incident: null, task: null });
  const staff = ref<User[]>([]);
  const mailboxes = ref<MailboxOption[]>([]);
  /** Bereiche des Benutzers (Admins alle, IT laut Verwaltung → Benutzer) */
  const areas = ref<Area[]>(['inbox', 'incident', 'task']);
  /** Einstellungen des Benutzers (auf dem Server gespeichert): Board oder Liste, Vorgang als Seite oder Fenster, Farbschema */
  const preferences = ref<Preferences>({
    layout: { incidents: 'list', tasks: 'board' },
    open: { inbox: 'modal', incident: 'modal', task: 'modal' },
    theme: 'auto',
  });
  /** Wie ein Vorgang dieses Typs öffnet (null = Eingang) */
  const openMode = (type: ItemType | null) => preferences.value.open[type ?? 'inbox'];

  const isAdmin = computed(() => user.value?.role === 'admin');
  /** Sieht der Benutzer den Bereich eines Typs (null = Eingang)? */
  const canSee = (type: ItemType | null) => areas.value.includes(type ?? 'inbox');
  /** Erster sichtbarer Bereich: Ziel nach dem Anmelden und bei gesperrten Ansichten */
  const homeRoute = computed(() => AREA_ROUTES[areas.value[0] ?? 'inbox']);
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
    const me = await api.get<{ user: User | null; impersonator: User | null }>('/auth/me');
    user.value = me.user;
    impersonator.value = me.impersonator;
  }

  async function login(username: string, password: string) {
    user.value = await api.post<User>('/auth/login', { username, password });
    impersonator.value = null;
    announceSessionChange(user.value.id, null);
    await loadUserData();
  }

  async function logout() {
    await api.post('/auth/logout');
    user.value = null;
    impersonator.value = null;
    announceSessionChange(null, null);
  }

  /*
   * Die Anmeldung (Cookie) gilt für alle Tabs. Wechselt sie in einem Tab (Anmelden, Abmelden, als anderer Benutzer
   * arbeiten und zurück), laden die übrigen neu, sofern sie unter einem anderen Konto stehen, damit nichts unbemerkt
   * unter einem anderen Konto geschieht. Tabs, die schon zum neuen Konto passen, bleiben (z.B. angefangene Antworten).
   */
  interface SessionIdentity {
    userId: string | null;
    impersonatorId: string | null;
  }
  const channel = typeof BroadcastChannel === 'undefined' ? null : new BroadcastChannel('patchwork-session');

  /** Den anderen Tabs das Konto nach dem Wechsel melden */
  function announceSessionChange(userId: string | null, impersonatorId: string | null) {
    channel?.postMessage({ userId, impersonatorId } satisfies SessionIdentity);
  }

  const sameIdentity = (other: SessionIdentity) =>
    other.userId === (user.value?.id ?? null) && other.impersonatorId === (impersonator.value?.id ?? null);

  /** Auf das neue Konto umstellen: auf der Anmeldeseite weiter zum Ziel, sonst die Seite neu laden */
  function followIdentity(other: SessionIdentity) {
    if (sameIdentity(other)) return;
    const params = new URLSearchParams(window.location.search);
    if (other.userId && window.location.pathname.startsWith('/login')) window.location.assign(params.get('weiter') ?? '/');
    else window.location.reload();
  }

  let watching = false;
  /** Einmal beim Start: auf Wechsel in anderen Tabs reagieren, zur Sicherheit auch beim Zurückkehren in den Tab prüfen. */
  function watchOtherTabs() {
    if (watching) return;
    watching = true;
    channel?.addEventListener('message', (e: MessageEvent<SessionIdentity>) => followIdentity(e.data));
    let checking = false;
    const check = async () => {
      if (document.visibilityState !== 'visible' || !user.value || checking) return;
      checking = true;
      try {
        const me = await api.get<{ user: User | null; impersonator: User | null }>('/auth/me');
        followIdentity({ userId: me.user?.id ?? null, impersonatorId: me.impersonator?.id ?? null });
      } catch {
        // z.B. offline; die nächste Anfrage zeigt den Fehler
      } finally {
        checking = false;
      }
    };
    document.addEventListener('visibilitychange', check);
    window.addEventListener('focus', check);
  }

  /** Nach dem Login: Admin und IT die Stammdaten, Melder (Portal) nur ihre Einstellungen (Farbschema) */
  async function loadUserData() {
    if (isStaff.value) await loadAppData();
    else if (user.value) await loadPreferences().catch(() => undefined);
  }

  /** Stammdaten nach dem Login. */
  async function loadAppData() {
    await Promise.all([refreshCounts(), loadStatuses(), loadChannels(), loadStaff(), loadMailboxes(), loadAreas(), loadPreferences()]);
  }

  async function loadAreas() {
    areas.value = (await api.get<{ areas: Area[] }>('/areas')).areas;
  }

  async function loadPreferences() {
    preferences.value = await api.get<Preferences>('/me/preferences');
    applyTheme(preferences.value.theme);
  }

  /** Einstellung ändern: sofort wirksam, danach gespeichert (bei einem Fehler wieder der gespeicherte Stand) */
  async function savePreferences(patch: {
    layout?: Partial<Preferences['layout']>;
    open?: Partial<Preferences['open']>;
    theme?: Preferences['theme'];
  }) {
    const before = preferences.value;
    preferences.value = {
      layout: { ...before.layout, ...patch.layout },
      open: { ...before.open, ...patch.open },
      theme: patch.theme ?? before.theme,
    };
    applyTheme(preferences.value.theme);
    try {
      preferences.value = await api.put<Preferences>('/me/preferences', patch);
    } catch (err) {
      preferences.value = before;
      throw err;
    } finally {
      applyTheme(preferences.value.theme);
    }
  }

  async function loadChannels() {
    [channels.value, channelDefaults.value] = await Promise.all([
      api.get<Channel[]>('/channels'),
      api.get<ChannelDefaults>('/channels/defaults'),
    ]);
  }

  /** Meldeweg nach ID, z.B. für Listen (dort steht nur die ID) */
  const channelById = (id: string | null | undefined) => (id ? channels.value.find((c) => c.id === id) : undefined);

  /** «background»: regelmässiges Nachladen ohne Zutun des Benutzers */
  async function refreshCounts(background = false) {
    counts.value = await api.get<Counts>('/items/counts', { background });
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
    impersonator,
    announceSessionChange,
    watchOtherTabs,
    counts,
    statuses,
    statusFlow,
    statusTargets,
    targetId,
    isRejectStatus,
    canReject,
    channels,
    channelDefaults,
    staff,
    mailboxes,
    areas,
    canSee,
    homeRoute,
    loadAreas,
    preferences,
    openMode,
    savePreferences,
    isAdmin,
    isStaff,
    appName,
    logoUrl,
    loadInfo,
    loadMe,
    login,
    logout,
    loadUserData,
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
