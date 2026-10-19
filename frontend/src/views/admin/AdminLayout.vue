<template>
  <div class="page admin">
    <nav class="admin-nav card">
      <h2>Verwaltung</h2>
      <RouterLink to="/admin/allgemein">Allgemein</RouterLink>
      <RouterLink to="/admin/benutzer">Benutzer</RouterLink>
      <RouterLink to="/admin/postfaecher">Postfächer</RouterLink>
      <RouterLink to="/admin/nicht-versendet">Nicht versendete Mails</RouterLink>
      <RouterLink to="/admin/status">Status</RouterLink>
      <RouterLink to="/admin/regeln">Regeln</RouterLink>
      <RouterLink to="/admin/checklisten">Checklisten-Vorlagen</RouterLink>
      <RouterLink to="/admin/textbausteine">Textbausteine</RouterLink>
      <RouterLink to="/admin/ldap">LDAP / AD</RouterLink>
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
  top: 72px;
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
  }
}
</style>
