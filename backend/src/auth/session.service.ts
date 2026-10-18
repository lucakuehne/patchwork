import { Injectable } from '@nestjs/common';
import { and, eq, gt, lt } from 'drizzle-orm';
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
   * Liefert den Benutzer zu einem Token. Ist die Sitzung zur Hälfte abgelaufen,
   * wird sie verlängert und das Cookie neu gesetzt.
   */
  async resolve(token: string, res: Response): Promise<{ user: User; sessionId: string } | null> {
    const id = sha256(token);
    const [row] = await this.db
      .select({ user: users, expiresAt: sessions.expiresAt })
      .from(sessions)
      .innerJoin(users, eq(users.id, sessions.userId))
      .where(and(eq(sessions.id, id), gt(sessions.expiresAt, new Date())))
      .limit(1);
    if (!row || !row.user.active) return null;

    if (row.expiresAt.getTime() - Date.now() < (SESSION_DAYS / 2) * DAY_MS) {
      const expiresAt = new Date(Date.now() + SESSION_DAYS * DAY_MS);
      await this.db.update(sessions).set({ expiresAt }).where(eq(sessions.id, id));
      this.setCookie(res, token, expiresAt);
    }
    return { user: row.user, sessionId: id };
  }

  async destroy(sessionId: string | undefined, res: Response): Promise<void> {
    if (sessionId) await this.db.delete(sessions).where(eq(sessions.id, sessionId));
    res.clearCookie(SESSION_COOKIE, { path: '/' });
  }

  async destroyAllForUser(userId: string): Promise<void> {
    await this.db.delete(sessions).where(eq(sessions.userId, userId));
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
