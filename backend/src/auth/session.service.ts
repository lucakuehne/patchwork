import { Injectable, UnauthorizedException } from '@nestjs/common';
import { and, eq, gt, lt, or } from 'drizzle-orm';
import type { Response } from 'express';
import { appConfig } from '../config';
import { randomToken, sha256 } from '../common/crypto';
import { InjectDb, type Db } from '../db/db.module';
import { sessions, users, type User } from '../db/schema';

export const SESSION_COOKIE = 'pw_session';
const SESSION_DAYS = 14;
const DAY_MS = 24 * 60 * 60 * 1000;

@Injectable()
export class SessionService {
  constructor(@InjectDb() private readonly db: Db) {}

  async create(userId: string, res: Response): Promise<void> {
    const token = randomToken();
    const expiresAt = new Date(Date.now() + SESSION_DAYS * DAY_MS);
    await this.db.insert(sessions).values({ id: sha256(token), userId, expiresAt });
    await this.db.update(users).set({ lastLoginAt: new Date() }).where(eq(users.id, userId));
    this.setCookie(res, token, expiresAt);
  }

  /**
   * Liefert den Benutzer zu einem Token, bei «Als dieser Benutzer arbeiten» auch den Admin dahinter. Die Sitzung gilt
   * dann nur, solange dieser aktiv und Admin ist. Ist die Sitzung zur Hälfte abgelaufen, wird sie verlängert und das
   * Cookie neu gesetzt.
   */
  async resolve(token: string, res: Response): Promise<{ user: User; sessionId: string; impersonator: User | null } | null> {
    const id = sha256(token);
    const [row] = await this.db
      .select({ user: users, expiresAt: sessions.expiresAt, impersonatorId: sessions.impersonatorId })
      .from(sessions)
      .innerJoin(users, eq(users.id, sessions.userId))
      .where(and(eq(sessions.id, id), gt(sessions.expiresAt, new Date())))
      .limit(1);
    if (!row || !row.user.active) return null;

    let impersonator: User | null = null;
    if (row.impersonatorId) {
      [impersonator = null] = await this.db.select().from(users).where(eq(users.id, row.impersonatorId)).limit(1);
      if (!impersonator?.active || impersonator.role !== 'admin') {
        // Der Admin dahinter ist es nicht mehr: Sitzung beenden, damit sie auch nach einer Reaktivierung nicht wieder gilt
        await this.db.delete(sessions).where(eq(sessions.id, id));
        return null;
      }
    }

    if (row.expiresAt.getTime() - Date.now() < (SESSION_DAYS / 2) * DAY_MS) {
      const expiresAt = new Date(Date.now() + SESSION_DAYS * DAY_MS);
      await this.db.update(sessions).set({ expiresAt }).where(eq(sessions.id, id));
      this.setCookie(res, token, expiresAt);
    }
    return { user: row.user, sessionId: id, impersonator };
  }

  /**
   * Sitzung wechseln («Als dieser Benutzer arbeiten» mit «impersonatorId», zurück ohne): alte Sitzung löschen und eine
   * neue anlegen, mit nur einem Cookie in der Antwort (nicht zuerst gelöscht und dann neu gesetzt). Zählt nicht als
   * Anmeldung, die letzte Anmeldung bleibt.
   */
  async switchTo(oldSessionId: string | undefined, userId: string, res: Response, impersonatorId: string | null): Promise<void> {
    if (oldSessionId) {
      // Wurde die Sitzung gerade anderswo beendet (z.B. Passwort zurückgesetzt), entsteht keine neue
      const deleted = await this.db.delete(sessions).where(eq(sessions.id, oldSessionId)).returning({ id: sessions.id });
      if (deleted.length === 0) throw new UnauthorizedException('Nicht angemeldet');
    }
    const token = randomToken();
    const expiresAt = new Date(Date.now() + SESSION_DAYS * DAY_MS);
    await this.db.insert(sessions).values({ id: sha256(token), userId, impersonatorId, expiresAt });
    this.setCookie(res, token, expiresAt);
  }

  async destroy(sessionId: string | undefined, res: Response): Promise<void> {
    if (sessionId) await this.db.delete(sessions).where(eq(sessions.id, sessionId));
    res.clearCookie(SESSION_COOKIE, { path: '/' });
  }

  /** Sitzungen beenden, in denen dieser Benutzer als Admin als jemand anderes arbeitet (z.B. wenn er nicht mehr Admin ist). */
  async destroyImpersonationsBy(adminId: string): Promise<void> {
    await this.db.delete(sessions).where(eq(sessions.impersonatorId, adminId));
  }

  /** Alle Sitzungen eines Benutzers beenden, auch die, in denen er als Admin als jemand anderes arbeitet. */
  async destroyAllForUser(userId: string): Promise<void> {
    await this.db.delete(sessions).where(or(eq(sessions.userId, userId), eq(sessions.impersonatorId, userId)));
  }

  async purgeExpired(): Promise<void> {
    await this.db.delete(sessions).where(lt(sessions.expiresAt, new Date()));
  }

  private setCookie(res: Response, token: string, expiresAt: Date) {
    res.cookie(SESSION_COOKIE, token, {
      httpOnly: true,
      sameSite: 'lax',
      secure: appConfig.secureCookies,
      path: '/',
      expires: expiresAt,
    });
  }
}
