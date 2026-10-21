import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { asc, eq, sql } from 'drizzle-orm';
import { InjectDb, type Db, type Tx } from '../db/db.module';
import { channels, items, type Channel } from '../db/schema';
import { SettingsService, type ChannelDefaults } from '../settings/settings.service';

/** Symbole zur Auswahl für die Meldewege (das Frontend zeichnet sie) */
export const CHANNEL_ICONS = ['mail', 'portal', 'phone', 'mobile', 'person', 'chat', 'video', 'letter', 'alert', 'other'] as const;
export type ChannelIcon = (typeof CHANNEL_ICONS)[number];

/** Meldewege, die Patchwork selbst setzt */
export type ChannelKey = 'mail' | 'portal';

/** Meldewege eines Vorgangs (E-Mail, Portal, Telefon …), in der Verwaltung pflegbar wie die Status. */
@Injectable()
export class ChannelsService {
  constructor(
    @InjectDb() private readonly db: Db,
    private readonly settings: SettingsService,
  ) {}

  /** Vorbelegung beim internen Erfassen je Typ; ein inzwischen fehlender Meldeweg gilt als keiner. */
  async defaults(): Promise<ChannelDefaults> {
    const [stored, all] = await Promise.all([this.settings.get('channelDefaults'), this.list()]);
    const usable = (id: string | null) => (id && all.some((c) => c.id === id && c.key !== 'portal') ? id : null);
    return { incident: usable(stored.incident), task: usable(stored.task) };
  }

  async setDefaults(input: ChannelDefaults): Promise<ChannelDefaults> {
    for (const id of [input.incident, input.task]) {
      if (!id) continue;
      const channel = await this.get(id);
      if (channel.key === 'portal') throw new BadRequestException('«Portal» setzt Patchwork selbst und lässt sich nicht vorbelegen');
    }
    await this.settings.set('channelDefaults', { incident: input.incident, task: input.task });
    return this.defaults();
  }

  list(tx: Tx = this.db): Promise<Channel[]> {
    return tx.select().from(channels).orderBy(asc(channels.position));
  }

  async get(id: string, tx: Tx = this.db): Promise<Channel> {
    const [channel] = await tx.select().from(channels).where(eq(channels.id, id)).limit(1);
    if (!channel) throw new NotFoundException('Meldeweg nicht gefunden');
    return channel;
  }

  /** Meldeweg, den Patchwork selbst setzt (Mail, Portal); fehlt er, bleibt der Vorgang ohne Angabe. */
  async idByKey(key: ChannelKey, tx: Tx = this.db): Promise<string | null> {
    const [row] = await tx.select({ id: channels.id }).from(channels).where(eq(channels.key, key)).limit(1);
    return row?.id ?? null;
  }

  async usage(): Promise<Record<string, number>> {
    const rows = await this.db
      .select({ channelId: items.channelId, count: sql<number>`count(*)::int` })
      .from(items)
      .groupBy(items.channelId);
    return Object.fromEntries(rows.filter((r) => r.channelId).map((r) => [r.channelId!, r.count]));
  }

  async create(input: { label: string; icon: ChannelIcon }): Promise<Channel> {
    return this.db.transaction(async (tx) => {
      await this.lock(tx);
      const all = await this.list(tx);
      this.assertUniqueLabel(all, input.label);
      const position = all.reduce((max, c) => Math.max(max, c.position), -1) + 1;
      const [created] = await tx.insert(channels).values({ label: input.label.trim(), icon: input.icon, position }).returning();
      return created!;
    });
  }

  async update(id: string, input: { label?: string; icon?: ChannelIcon }): Promise<Channel> {
    return this.db.transaction(async (tx) => {
      await this.lock(tx);
      const current = await this.get(id, tx);
      const changes: Partial<Channel> = {};
      if (input.label !== undefined && input.label.trim() !== current.label) {
        this.assertUniqueLabel((await this.list(tx)).filter((c) => c.id !== id), input.label);
        changes.label = input.label.trim();
      }
      if (input.icon !== undefined) changes.icon = input.icon;
      if (Object.keys(changes).length === 0) return current;
      const [updated] = await tx.update(channels).set(changes).where(eq(channels.id, id)).returning();
      return updated!;
    });
  }

  async reorder(ids: string[]): Promise<void> {
    await this.db.transaction(async (tx) => {
      await this.lock(tx);
      const all = await this.list(tx);
      const known = new Set(all.map((c) => c.id));
      if (ids.length !== all.length || new Set(ids).size !== ids.length || !ids.every((id) => known.has(id))) {
        throw new BadRequestException('Die Reihenfolge muss alle Meldewege genau einmal enthalten');
      }
      for (const [position, id] of ids.entries()) await tx.update(channels).set({ position }).where(eq(channels.id, id));
    });
  }

  /** Löscht einen Meldeweg. Vorgänge mit diesem Meldeweg erhalten den Ersatz. E-Mail und Portal bleiben. */
  async remove(id: string, replacementId: string | null): Promise<void> {
    await this.db.transaction(async (tx) => {
      await this.lock(tx);
      const current = await this.get(id, tx);
      if (current.key) throw new BadRequestException(`«${current.label}» setzt Patchwork selbst und lässt sich nicht löschen.`);
      const [usage] = await tx
        .select({ count: sql<number>`count(*)::int` })
        .from(items)
        .where(eq(items.channelId, id));
      if ((usage?.count ?? 0) > 0) {
        if (!replacementId) throw new BadRequestException('Der Meldeweg wird verwendet. Bitte einen Ersatz wählen.');
        if (replacementId === id) throw new BadRequestException('Der Ersatz muss ein anderer Meldeweg sein');
        await this.get(replacementId, tx);
        await tx.update(items).set({ channelId: replacementId }).where(eq(items.channelId, id));
      }
      await tx.delete(channels).where(eq(channels.id, id));
      const remaining = (await this.list(tx)).filter((c) => c.id !== id);
      for (const [position, c] of remaining.entries()) await tx.update(channels).set({ position }).where(eq(channels.id, c.id));
    });
    // Vorbelegung: Der Ersatz übernimmt sie; ohne Ersatz (Meldeweg unbenutzt) entfällt sie
    const stored = await this.settings.get('channelDefaults');
    if (stored.incident === id || stored.task === id) {
      const replace = (current: string | null) => (current === id ? replacementId : current);
      await this.settings.set('channelDefaults', { incident: replace(stored.incident), task: replace(stored.task) });
    }
  }

  private assertUniqueLabel(others: Channel[], label: string) {
    const wanted = label.trim().toLowerCase();
    if (others.some((c) => c.label.toLowerCase() === wanted)) throw new BadRequestException('Diesen Meldeweg gibt es schon');
  }

  /** Serialisiert Änderungen an den Meldewegen. */
  private async lock(tx: Tx) {
    await tx.execute(sql`select pg_advisory_xact_lock(4711003)`);
  }
}
