import { Injectable } from '@nestjs/common';
import { LdapService } from '../auth/ldap.service';
import type { User } from '../db/schema';
import { SettingsService } from '../settings/settings.service';

/** Mitgliedschaft in der AD-Gruppe so lange zwischenspeichern */
const GROUP_CACHE_MS = 5 * 60 * 1000;

export const PORTAL_REFUSED = 'Das Portal ist für dich nicht freigeschaltet. Bitte wende dich per Mail an die IT.';

/**
 * Wer das Portal nutzen darf: niemand, nur ausgewählte (einzelne Personen und Mitglieder einer AD-Gruppe) oder alle.
 * IT und Admins sind nicht betroffen, sie arbeiten in der normalen Oberfläche.
 */
@Injectable()
export class PortalAccessService {
  private readonly groupCache = new Map<string, { member: boolean; at: number }>();

  constructor(
    private readonly settings: SettingsService,
    private readonly ldap: LdapService,
  ) {}

  async allowed(user: Pick<User, 'email' | 'role'>): Promise<boolean> {
    if (user.role === 'admin' || user.role === 'it') return true;
    const portal = await this.settings.get('portal');
    if (portal.access === 'all') return true;
    if (portal.access === 'none') return false;
    const email = user.email.trim().toLowerCase();
    if (portal.emails.includes(email)) return true;
    const groupDn = portal.groupDn.trim();
    return groupDn ? this.inGroup(email, groupDn) : false;
  }

  private async inGroup(email: string, groupDn: string): Promise<boolean> {
    const key = `${email}|${groupDn.toLowerCase()}`;
    const cached = this.groupCache.get(key);
    if (cached && Date.now() - cached.at < GROUP_CACHE_MS) return cached.member;
    const checker = this.ldap.groupChecker(await this.settings.get('ldap'));
    try {
      const member = await checker.check(email, groupDn);
      // Verzeichnis nicht erreichbar: kein Zugang, beim nächsten Mal neu prüfen
      if (member === null) return false;
      if (this.groupCache.size > 5000) this.groupCache.clear();
      this.groupCache.set(key, { member, at: Date.now() });
      return member;
    } finally {
      await checker.close();
    }
  }

  /** Nach einer Änderung der Einstellung gelten die gespeicherten Ergebnisse nicht mehr. */
  forget(): void {
    this.groupCache.clear();
  }
}
