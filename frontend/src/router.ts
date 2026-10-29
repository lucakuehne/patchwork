import { createRouter, createWebHistory } from 'vue-router';
import { parseItemRef } from './item-ref';
import { legacyLocation } from './legacy-urls';
import { useSession } from './stores/session';
import type { Area } from './types';

export const router = createRouter({
  history: createWebHistory(),
  routes: [
    { path: '/', redirect: '/inbox' },
    { path: '/login', name: 'login', component: () => import('./views/LoginView.vue'), meta: { public: true } },
    { path: '/setup', name: 'setup', component: () => import('./views/SetupView.vue'), meta: { public: true } },
    // «area»: nur mit Zugriff auf diesen Bereich (Bereiche je Rolle, siehe beforeEach)
    { path: '/inbox', name: 'inbox', component: () => import('./views/InboxView.vue'), meta: { area: 'inbox' } },
    {
      path: '/incidents',
      name: 'incidents',
      component: () => import('./views/IncidentsView.vue'),
      props: { closed: false },
      meta: { area: 'incident' },
    },
    {
      path: '/incidents/resolved',
      name: 'incidents-closed',
      component: () => import('./views/IncidentsView.vue'),
      props: { closed: true },
      meta: { area: 'incident' },
    },
    { path: '/tasks', name: 'tasks', component: () => import('./views/TasksView.vue'), meta: { area: 'task' } },
    {
      path: '/tasks/done',
      name: 'tasks-done',
      component: () => import('./views/TasksClosedView.vue'),
      props: { view: 'tasks-done' },
      meta: { area: 'task' },
    },
    // Nur mit Ablehnen-Ziel für Aufgaben (siehe beforeEach)
    {
      path: '/tasks/rejected',
      name: 'tasks-rejected',
      component: () => import('./views/TasksClosedView.vue'),
      props: { view: 'tasks-rejected' },
      meta: { area: 'task' },
    },
    { path: '/search', name: 'search', component: () => import('./views/SearchView.vue') },
    { path: '/settings', name: 'settings', component: () => import('./views/SettingsView.vue') },
    {
      // Kennung mit Präfix, z.B. /items/PW-123 oder /items/HS-17223 (ohne Präfix leitet legacy-urls.ts weiter)
      path: '/items/:ref',
      name: 'item',
      component: () => import('./views/ItemView.vue'),
      props: (route) => ({ itemKey: parseItemRef(route.params.ref) }),
    },
    {
      path: '/admin',
      component: () => import('./views/admin/AdminLayout.vue'),
      meta: { admin: true },
      children: [
        { path: '', redirect: '/admin/general' },
        { path: 'general', name: 'admin-general', component: () => import('./views/admin/AdminGeneral.vue') },
        { path: 'users', name: 'admin-users', component: () => import('./views/admin/AdminUsers.vue') },
        { path: 'mailboxes', name: 'admin-mailboxes', component: () => import('./views/admin/AdminMailboxes.vue') },
        {
          path: 'outgoing-mails',
          name: 'admin-outgoing-mails',
          component: () => import('./views/admin/AdminOutgoingMails.vue'),
        },
        {
          path: 'incoming-mails',
          name: 'admin-incoming-mails',
          component: () => import('./views/admin/AdminIncomingMails.vue'),
        },
        {
          path: 'mail-templates',
          name: 'admin-mail-templates',
          component: () => import('./views/admin/AdminMailTemplates.vue'),
        },
        { path: 'statuses', name: 'admin-statuses', component: () => import('./views/admin/AdminStatuses.vue') },
        { path: 'channels', name: 'admin-channels', component: () => import('./views/admin/AdminChannels.vue') },
        { path: 'ldap', name: 'admin-ldap', component: () => import('./views/admin/AdminLdap.vue') },
        { path: 'https', name: 'admin-https', component: () => import('./views/admin/AdminHttps.vue') },
        {
          path: 'checklist-templates',
          name: 'admin-checklists',
          component: () => import('./views/admin/AdminChecklistTemplates.vue'),
        },
        { path: 'snippets', name: 'admin-snippets', component: () => import('./views/admin/AdminSnippets.vue') },
        { path: 'rules', name: 'admin-rules', component: () => import('./views/admin/AdminRules.vue') },
        { path: 'helpspot', name: 'admin-helpspot', component: () => import('./views/admin/AdminHelpSpot.vue') },
      ],
    },
    {
      path: '/reports',
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
        { path: 'new', name: 'portal-new', component: () => import('./views/portal/PortalNew.vue') },
        {
          path: 'items/:ref',
          name: 'portal-item',
          component: () => import('./views/portal/PortalItem.vue'),
          props: (route) => ({ itemKey: parseItemRef(route.params.ref) }),
        },
      ],
    },
    // Frühere deutsche Adressen führen weiter, alles Übrige in den Eingang
    {
      path: '/:pathMatch(.*)*',
      redirect: (to) => {
        const legacy = legacyLocation(to.path, to.query);
        return legacy ? { ...legacy, hash: to.hash } : '/inbox';
      },
    },
  ],
});

router.beforeEach(async (to) => {
  // Frühere deutsche Parameter (z.B. «?vorgang=») auf bestehenden Seiten
  const legacy = legacyLocation(to.path, to.query);
  if (legacy) return { ...legacy, hash: to.hash, replace: true };

  const session = useSession();
  if (!session.info) await session.loadInfo();

  if (session.info?.setupRequired) return to.name === 'setup' ? true : { name: 'setup' };
  if (to.name === 'setup') return { name: 'login' };

  if (to.meta.public) return true;
  if (!session.user) {
    await session.loadMe();
    await session.loadUserData();
  }
  if (!session.user) return { name: 'login', query: to.fullPath !== '/inbox' ? { next: to.fullPath } : {} };

  const portalRoute = to.matched.some((r) => r.meta.portal);
  if (!session.isStaff) {
    // Standard-Benutzer sehen nur das Portal
    return portalRoute ? true : { name: 'portal-home' };
  }
  if (portalRoute) {
    // Admin und IT nutzen die normale Oberfläche; Links auf einen Vorgang im Portal führen direkt dorthin
    return to.name === 'portal-item' ? { name: 'item', params: { ref: to.params.ref } } : { name: session.homeRoute };
  }
  if (to.matched.some((r) => r.meta.admin) && !session.isAdmin) return { name: session.homeRoute };
  // Bereiche ohne Zugriff (z.B. «/» bzw. Eingang, wenn die IT ihn nicht sieht): zum ersten sichtbaren Bereich
  const area = to.meta.area as Area | undefined;
  if (area && !session.areas.includes(area)) return { name: session.homeRoute };
  // Ohne Ablehnen-Ziel für Aufgaben gibt es die Ansicht «Abgelehnt» nicht; abgeschlossene Aufgaben stehen unter «Erledigt»
  if (to.name === 'tasks-rejected' && !session.statusTargets.task.reject) return { name: 'tasks-done' };
  return true;
});
