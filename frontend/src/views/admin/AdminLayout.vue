<template>
  <div class="page admin">
    <nav class="admin-nav card">
      <h2>Verwaltung</h2>
      <RouterLink to="/admin/general">Allgemein</RouterLink>
      <RouterLink to="/admin/users">Benutzer</RouterLink>
      <RouterLink to="/admin/mailboxes">Postfächer</RouterLink>
      <RouterLink to="/admin/incoming-mails">Eingehende Mails</RouterLink>
      <RouterLink to="/admin/outgoing-mails">Ausgehende Mails</RouterLink>
      <RouterLink to="/admin/mail-templates">E-Mail-Vorlagen</RouterLink>
      <RouterLink to="/admin/statuses">Status</RouterLink>
      <RouterLink to="/admin/channels">Meldewege</RouterLink>
      <RouterLink to="/admin/rules">Regeln</RouterLink>
      <RouterLink to="/admin/checklist-templates">Checklisten-Vorlagen</RouterLink>
      <RouterLink to="/admin/snippets">Textbausteine</RouterLink>
      <RouterLink to="/admin/ldap">LDAP / AD</RouterLink>
      <RouterLink to="/admin/https">HTTPS</RouterLink>
      <RouterLink to="/admin/helpspot">HelpSpot-Import</RouterLink>
    </nav>
    <section class="admin-content">
      <RouterView />
    </section>
  </div>
</template>

<style scoped>
.admin {
  display: grid;
  grid-template-columns: 200px minmax(0, 1fr);
  gap: 20px;
  align-items: start;
}
.admin-nav {
  display: flex;
  flex-direction: column;
  padding: 12px;
  gap: 2px;
  position: sticky;
  /* unter Hinweisbalken und Kopfzeile (useStickyTop), bei Bedarf in sich scrollbar */
  top: calc(var(--sticky-top, 56px) + 16px);
  max-height: calc(100vh - var(--sticky-top, 56px) - 32px);
  overflow-y: auto;
}
.admin-nav h2 {
  font-size: 13px;
  color: var(--text-muted);
  padding: 4px 8px 8px;
}
.admin-nav a {
  padding: 7px 8px;
  border-radius: var(--radius-sm);
  color: var(--text);
  text-decoration: none;
}
.admin-nav a:hover {
  background: var(--surface-hover);
}
.admin-nav a.router-link-active {
  background: var(--accent-soft);
  color: var(--accent);
  font-weight: 500;
}
.admin-content {
  min-width: 0;
}
@media (max-width: 800px) {
  .admin {
    grid-template-columns: 1fr;
  }
  .admin-nav {
    position: static;
    max-height: none;
    overflow-y: visible;
  }
}
</style>
