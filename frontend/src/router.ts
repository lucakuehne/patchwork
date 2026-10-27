import { createRouter, createWebHistory } from 'vue-router';
import { useSession } from './stores/session';
import type { Area } from './types';

export const router = createRouter({
  history: createWebHistory(),
  routes: [
    { path: '/', redirect: '/eingang' },
    { path: '/login', name: 'login', component: () => import('./views/LoginView.vue'), meta: { public: true } },
    { path: '/einrichtung', name: 'setup', component: () => import('./views/SetupView.vue'), meta: { public: true } },
    // «area»: nur mit Zugriff auf diesen Bereich (Bereiche je Rolle, siehe beforeEach)
    { path: '/eingang', name: 'inbox', component: () => import('./views/InboxView.vue'), meta: { area: 'inbox' } },
    {
      path: '/stoerungen',
      name: 'incidents',
      component: () => import('./views/IncidentsView.vue'),
      props: { closed: false },
      meta: { area: 'incident' },
    },
    {
      path: '/stoerungen/geloest',
      name: 'incidents-closed',
      component: () => import('./views/IncidentsView.vue'),
      props: { closed: true },
      meta: { area: 'incident' },
    },
    { path: '/aufgaben', name: 'tasks', component: () => import('./views/TasksView.vue'), meta: { area: 'task' } },
    {
      path: '/aufgaben/erledigt',
      name: 'tasks-done',
      component: () => import('./views/TasksClosedView.vue'),
      props: { view: 'tasks-done' },
      meta: { area: 'task' },
    },
    // Nur mit Ablehnen-Ziel für Aufgaben (siehe beforeEach)
    {
      path: '/aufgaben/abgelehnt',
      name: 'tasks-rejected',
      component: () => import('./views/TasksClosedView.vue'),
      props: { view: 'tasks-rejected' },
      meta: { area: 'task' },
    },
    { path: '/suche', name: 'search', component: () => import('./views/SearchView.vue') },
    { path: '/einstellungen', name: 'settings', component: () => import('./views/SettingsView.vue') },
    {
      path: '/v/:number(\\d+)',
      name: 'item',
      component: () => import('./views/ItemView.vue'),
      props: (route) => ({ number: Number(route.params.number) }),
    },
    {
      path: '/admin',
      component: () => import('./views/admin/AdminLayout.vue'),
      meta: { admin: true },
      children: [
        { path: '', redirect: '/admin/allgemein' },
        { path: 'allgemein', name: 'admin-general', component: () => import('./views/admin/AdminGeneral.vue') },
        { path: 'benutzer', name: 'admin-users', component: () => import('./views/admin/AdminUsers.vue') },
        { path: 'postfaecher', name: 'admin-mailboxes', component: () => import('./views/admin/AdminMailboxes.vue') },
        {
          path: 'ausgehende-mails',
          name: 'admin-outgoing-mails',
          component: () => import('./views/admin/AdminOutgoingMails.vue'),
        },
        {
          path: 'eingehende-mails',
          name: 'admin-incoming-mails',
          component: () => import('./views/admin/AdminIncomingMails.vue'),
        },
        {
          path: 'e-mail-vorlagen',
          name: 'admin-mail-templates',
          component: () => import('./views/admin/AdminMailTemplates.vue'),
        },
        // Frühere Seite: nur die nicht versendeten Mails
        { path: 'nicht-versendet', redirect: { path: '/admin/ausgehende-mails', query: { status: 'nicht-versendet' } } },
        { path: 'status', name: 'admin-statuses', component: () => import('./views/admin/AdminStatuses.vue') },
        { path: 'meldewege', name: 'admin-channels', component: () => import('./views/admin/AdminChannels.vue') },
        { path: 'ldap', name: 'admin-ldap', component: () => import('./views/admin/AdminLdap.vue') },
        { path: 'https', name: 'admin-https', component: () => import('./views/admin/AdminHttps.vue') },
        {
          path: 'checklisten',
          name: 'admin-checklists',
          component: () => import('./views/admin/AdminChecklistTemplates.vue'),
        },
        { path: 'textbausteine', name: 'admin-snippets', component: () => import('./views/admin/AdminSnippets.vue') },
        { path: 'regeln', name: 'admin-rules', component: () => import('./views/admin/AdminRules.vue') },
      ],
    },
    {
      path: '/auswertungen',
      name: 'reports',
      component: () => import('./views/ReportsView.vue'),
      meta: { admin: true },
    },
    {
      path: '/portal',
      component: () => import('./views/portal/PortalLayout.vue'),
      meta: { portal: true },
      children: [
        { path: '', name: 'portal-home', component: () => import('./views/portal/PortalHome.vue') },
        { path: 'neu', name: 'portal-new', component: () => import('./views/portal/PortalNew.vue') },
        {
          path: 'v/:number(\\d+)',
          name: 'portal-item',
          component: () => import('./views/portal/PortalItem.vue'),
          props: (route) => ({ number: Number(route.params.number) }),
        },
      ],
    },
    { path: '/:pathMatch(.*)*', redirect: '/eingang' },
  ],
});

router.beforeEach(async (to) => {
  const session = useSession();
  if (!session.info) await session.loadInfo();

  if (session.info?.setupRequired) return to.name === 'setup' ? true : { name: 'setup' };
  if (to.name === 'setup') return { name: 'login' };

  if (to.meta.public) return true;
  if (!session.user) {
    await session.loadMe();
    if (session.isStaff) await session.loadAppData();
  }
  if (!session.user) return { name: 'login', query: to.fullPath !== '/eingang' ? { weiter: to.fullPath } : {} };

  const portalRoute = to.matched.some((r) => r.meta.portal);
  if (!session.isStaff) {
    // Standard-Benutzer sehen nur das Portal
    return portalRoute ? true : { name: 'portal-home' };
  }
  if (portalRoute) {
    // Admin und IT nutzen die normale Oberfläche; Links auf einen Vorgang im Portal führen direkt dorthin
    return to.name === 'portal-item' ? { name: 'item', params: { number: to.params.number } } : { name: session.homeRoute };
  }
  if (to.matched.some((r) => r.meta.admin) && !session.isAdmin) return { name: session.homeRoute };
  // Bereiche ohne Zugriff (z.B. «/» bzw. Eingang, wenn die IT ihn nicht sieht): zum ersten sichtbaren Bereich
  const area = to.meta.area as Area | undefined;
  if (area && !session.areas.includes(area)) return { name: session.homeRoute };
  // Ohne Ablehnen-Ziel für Aufgaben gibt es die Ansicht «Abgelehnt» nicht; abgeschlossene Aufgaben stehen unter «Erledigt»
  if (to.name === 'tasks-rejected' && !session.statusTargets.task.reject) return { name: 'tasks-done' };
  return true;
});
