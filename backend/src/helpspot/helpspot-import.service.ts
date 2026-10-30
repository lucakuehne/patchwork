import { BadRequestException, ConflictException, Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { and, count, desc, eq, inArray, isNotNull, sql } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';
import { ChannelsService } from '../channels/channels.service';
import { decryptSecret, encryptSecret } from '../common/crypto';
import { InjectDb, type Db, type Tx } from '../db/db.module';
import {
  attachments,
  entries,
  helpspotImportRuns,
  helpspotTickets,
  items,
  links,
  mailMessages,
  statuses,
  users,
  type HelpSpotImportRun,
  type Item,
  type ItemType,
  type User,
} from '../db/schema';
import { HELPSPOT_PREFIX, itemRef } from '../items/item-ref';
import { ItemsService } from '../items/items.service';
import { LINK_ROLE_LABELS } from '../items/links.service';
import { referenceMeta } from '../items/references';
import { sanitizeMailHtml } from '../mail/mail-content';
import { SettingsService, type HelpSpotAnalysis, type HelpSpotSettings } from '../settings/settings.service';
import { StatusesService } from '../statuses/statuses.service';
import { StorageService } from '../storage/storage.service';
import { UsersService } from '../users/users.service';
import { HelpSpotClient, HelpSpotError } from './helpspot-client';
import { changeText, effectiveMappings, htmlToText, resolveTicket, suggestCopyKeep, type MappingContext } from './helpspot-map';
import { normalizeTicket, type HsFile, type HsHistoryItem, type HsTicket } from './helpspot-ticket';

/** Zeitzone, in der HelpSpot die Zeiten der API formatiert */
const TIME_ZONE = 'Europe/Zurich';
/** Melder ohne E-Mail-Adresse in HelpSpot (Name steht beim Vorgang) */
const NO_EMAIL_CONTACT = { email: 'ohne-email@helpspot.invalid', name: 'Ohne E-Mail (HelpSpot)' };
const MAX_ERRORS = 50;

export interface HelpSpotSettingsInput {
  url: string;
  /** undefined = unverändert, '' = löschen */
  apiKey?: string;
  types: HelpSpotSettings['types'];
  statuses: HelpSpotSettings['statuses'];
  channels: HelpSpotSettings['channels'];
}

type Outcome = 'created' | 'updated' | 'skipped' | 'skippedOpen';

type ItemRefFields = { id: string; prefix: string; number: number; title: string; status: { label: string; closed: boolean } | null };

/** Paar aus der Parallelphase: Vorgang aus Patchwork (Kopie) und HS-Vorgang aus derselben ersten Mail */
export interface CopyPair {
  copy: ItemRefFields & { type: ItemType | null; discarded: boolean };
  original: ItemRefFields & { type: ItemType | null };
  /** Vorschlag, welcher bleibt: «copy» bei Aufgaben und Kopien mit Antworten oder Notizen der IT */
  suggestion: { keep: 'copy' | 'original'; reason: 'task' | 'staffEntries' | null };
}

/** Wahl beim Bereinigen: welcher Vorgang eines Paars bleibt */
export interface CopyChoice {
  copyId: string;
  keep: 'copy' | 'original';
}

/** Was ein Lauf für alle Tickets einmal lädt */
interface RunContext extends MappingContext {
  settings: HelpSpotSettings;
  /** Auch offene Tickets übernehmen, sonst nur geschlossene */
  includeOpen: boolean;
  /** Name (klein) → E-Mail der Mitarbeitenden in HelpSpot */
  staffEmail: Map<string, string>;
  users: Map<string, User | null>;
}

/**
 * Import aus HelpSpot (Entscheid vom 29.10.2026): Tickets werden Vorgänge mit Präfix HS und der Nummer aus HelpSpot,
 * mit Verlauf und Anhängen, ohne Regeln, Mails oder Benachrichtigungen. Jeder Lauf holt die Tickets, die sich seit dem
 * letzten erfolgreichen Lauf geändert haben; bereits übernommene werden ergänzt statt doppelt angelegt. Ein Lauf nimmt
 * nur geschlossene Tickets oder (am Stichtag) auch offene; dann holt er alle offenen, auch die seither unveränderten,
 * weil frühere Läufe sie ausgelassen haben (Entscheid vom 30.10.2026).
 */
@Injectable()
export class HelpSpotImportService implements OnModuleInit {
  private readonly logger = new Logger(HelpSpotImportService.name);
  private running: Promise<void> | null = null;

  constructor(
    @InjectDb() private readonly db: Db,
    private readonly settings: SettingsService,
    private readonly users: UsersService,
    private readonly statuses: StatusesService,
    private readonly channels: ChannelsService,
    private readonly storage: StorageService,
    private readonly items: ItemsService,
  ) {}

  /** Ein Neustart beendet laufende Importe: als abgebrochen vermerken */
  async onModuleInit() {
    await this.db
      .update(helpspotImportRuns)
      .set({ status: 'failed', finishedAt: new Date(), error: 'Abgebrochen, weil Patchwork neu gestartet wurde' })
      .where(eq(helpspotImportRuns.status, 'running'));
  }

  // ---------------------------------------------------------------- Einstellungen und Übersicht

  async view() {
    const [settings, context, runs, [imported]] = await Promise.all([
      this.settings.get('helpspot'),
      this.mappingContext(),
      this.db.select().from(helpspotImportRuns).orderBy(desc(helpspotImportRuns.startedAt)).limit(10),
      this.db.select({ n: count() }).from(helpspotTickets),
    ]);
    return {
      url: settings.url,
      hasApiKey: !!settings.apiKeyEnc,
      analysis: settings.analysis,
      mappings: effectiveMappings(settings, settings.analysis, context),
      runs,
      imported: imported?.n ?? 0,
    };
  }

  async save(input: HelpSpotSettingsInput) {
    const current = await this.settings.get('helpspot');
    const url = input.url.trim().replace(/\/+$/, '');
    // Neue Adresse ohne neuen Schlüssel: der alte gilt nicht für ein anderes HelpSpot
    const keepKey = input.apiKey === undefined && url === current.url;
    await this.settings.set('helpspot', {
      ...current,
      url,
      apiKeyEnc: input.apiKey ? encryptSecret(input.apiKey.trim()) : keepKey ? current.apiKeyEnc : null,
      types: input.types,
      statuses: input.statuses,
      channels: input.channels,
      analysis: url === current.url ? current.analysis : null,
    });
    return this.view();
  }

  /** Verbindung prüfen und die Übersicht über Status, Typen und «Eröffnet über» neu erstellen */
  async refreshAnalysis() {
    try {
      return await this.analyze(await this.client());
    } catch (err) {
      // Fehler von HelpSpot (Adresse, Schlüssel, Bremse) als verständliche Meldung auf der Seite
      if (err instanceof HelpSpotError) throw new BadRequestException(err.message);
      throw err;
    }
  }

  private async analyze(client: HelpSpotClient) {
    const types = await client.statusTypes();
    const statusCounts = new Map<string, { status: string; open: boolean; count: number }>();
    const typeCounts = new Map<string, number>();
    const viaCounts = new Map<string, number>();
    let total = 0;
    for (const status of types.filter((s) => !/^spam$/i.test(s.name))) {
      for (const row of await client.search({ xStatus: status.id })) {
        if (String(row.fTrash) === '1') continue;
        total++;
        const open = String(row.fOpen) === '1';
        const key = `${status.name}|${open}`;
        const entry = statusCounts.get(key) ?? { status: status.name, open, count: 0 };
        entry.count++;
        statusCounts.set(key, entry);
        const type = String(row.Custom1 ?? '').trim();
        typeCounts.set(type, (typeCounts.get(type) ?? 0) + 1);
        const via = String(row.fOpenedVia ?? '').trim();
        viaCounts.set(via, (viaCounts.get(via) ?? 0) + 1);
      }
    }
    const byCount = <T extends { count: number }>(list: T[]) => list.sort((a, b) => b.count - a.count);
    const analysis: HelpSpotAnalysis = {
      at: new Date().toISOString(),
      total,
      statuses: byCount([...statusCounts.values()]),
      types: byCount([...typeCounts].map(([value, n]) => ({ value, count: n }))),
      openedVia: byCount([...viaCounts].map(([value, n]) => ({ value, count: n }))),
    };
    await this.settings.set('helpspot', { ...(await this.settings.get('helpspot')), analysis });
    return this.view();
  }

  private async client(): Promise<HelpSpotClient> {
    const settings = await this.settings.get('helpspot');
    if (!settings.url || !settings.apiKeyEnc) throw new BadRequestException('Bitte zuerst Adresse und API-Schlüssel von HelpSpot speichern');
    return new HelpSpotClient(settings.url, decryptSecret(settings.apiKeyEnc));
  }

  private async mappingContext(tx: Tx = this.db): Promise<MappingContext> {
    const [targets, list, channelList, mailChannelId] = await Promise.all([
      this.statuses.targets(tx),
      this.statuses.list(tx),
      this.channels.list(tx),
      this.channels.idByKey('mail', tx),
    ]);
    return {
      targets,
      statuses: list.map((s) => ({ id: s.id, type: s.type, closed: s.closed })),
      channels: channelList.map((c) => ({ id: c.id, label: c.label })),
      mailChannelId,
    };
  }

  // ---------------------------------------------------------------- Import

  /** Startet einen Lauf im Hintergrund; die Seite fragt den Fortschritt ab */
  async start(actor: User, includeOpen: boolean): Promise<HelpSpotImportRun> {
    if (this.running) throw new ConflictException('Es läuft bereits ein Import');
    const client = await this.client();
    const [last] = await this.db
      .select({ startedAt: helpspotImportRuns.startedAt })
      .from(helpspotImportRuns)
      .where(eq(helpspotImportRuns.status, 'done'))
      .orderBy(desc(helpspotImportRuns.startedAt))
      .limit(1);
    const [run] = await this.db
      .insert(helpspotImportRuns)
      .values({ startedById: actor.id, since: last?.startedAt ?? null, includeOpen })
      .returning();
    this.running = this.run(run!, client).finally(() => (this.running = null));
    return run!;
  }

  /** Für Tests: auf das Ende des laufenden Imports warten */
  async idle(): Promise<void> {
    await this.running;
  }

  private async run(run: HelpSpotImportRun, client: HelpSpotClient): Promise<void> {
    const counts = { created: 0, updated: 0, skipped: 0, skippedOpen: 0, failed: 0, processed: 0 };
    const errors: { number: number; message: string }[] = [];
    const progress = () => this.db.update(helpspotImportRuns).set({ ...counts, errors }).where(eq(helpspotImportRuns.id, run.id));
    try {
      // Kleiner Überlapp, damit nichts zwischen zwei Läufen verloren geht
      const since = run.since ? Math.floor(run.since.getTime() / 1000) - 300 : 1;
      const changed = await client.changedSince(since);
      const numbers = run.includeOpen ? [...new Set([...changed, ...(await this.openNumbers(client))])].sort((a, b) => a - b) : changed;
      await this.db.update(helpspotImportRuns).set({ total: numbers.length }).where(eq(helpspotImportRuns.id, run.id));
      const context: RunContext = {
        ...(await this.mappingContext()),
        settings: await this.settings.get('helpspot'),
        includeOpen: run.includeOpen,
        staffEmail: new Map((await client.staff()).filter((s) => s.email).map((s) => [s.name.toLowerCase(), s.email])),
        users: new Map(),
      };
      for (const number of numbers) {
        try {
          counts[await this.importTicket(client, number, context)]++;
        } catch (err) {
          counts.failed++;
          if (errors.length < MAX_ERRORS) errors.push({ number, message: (err as Error).message });
          this.logger.warn(`HelpSpot-Ticket ${number} nicht übernommen: ${(err as Error).message}`);
        }
        counts.processed++;
        if (counts.processed % 10 === 0) await progress();
      }
      await this.db
        .update(helpspotImportRuns)
        .set({ ...counts, errors, status: 'done', finishedAt: new Date() })
        .where(eq(helpspotImportRuns.id, run.id));
      this.logger.log(
        `Import aus HelpSpot (${run.includeOpen ? 'mit offenen' : 'nur geschlossene'}): ${counts.created} neu, ${counts.updated} ergänzt, ` +
          `${counts.skipped} übersprungen, ${counts.skippedOpen} offene ausgelassen, ${counts.failed} Fehler`,
      );
    } catch (err) {
      await this.db
        .update(helpspotImportRuns)
        .set({ ...counts, errors, status: 'failed', finishedAt: new Date(), error: (err as Error).message })
        .where(eq(helpspotImportRuns.id, run.id));
      this.logger.error(`Import aus HelpSpot abgebrochen: ${(err as Error).message}`);
    }
  }

  /** Nummern aller offenen Tickets (ohne Spam und Papierkorb), über die Suche je Status wie bei der Übersicht */
  private async openNumbers(client: HelpSpotClient): Promise<number[]> {
    const numbers: number[] = [];
    for (const status of (await client.statusTypes()).filter((s) => !/^spam$/i.test(s.name))) {
      for (const row of await client.search({ xStatus: status.id })) {
        if (String(row.fOpen) === '1' && String(row.fTrash) !== '1') numbers.push(Number(row.xRequest));
      }
    }
    return numbers.filter((n) => Number.isInteger(n) && n > 0);
  }

  /** Ein Ticket übernehmen oder ergänzen */
  private async importTicket(client: HelpSpotClient, number: number, ctx: RunContext): Promise<Outcome> {
    const raw = await client.request(number);
    const t = normalizeTicket(raw, TIME_ZONE);
    // Zusammengeführt (HelpSpot liefert das Ziel), im Papierkorb oder Spam: nicht übernehmen
    if (t.number !== number || t.trash || t.spam) return 'skipped';
    // Offene Tickets erst am Stichtag; ein früher übernommenes bleibt bis dahin auf dem Stand des letzten Imports
    if (t.open && !ctx.includeOpen) return 'skippedOpen';
    const { type, statusId, channelId } = resolveTicket(t, ctx.settings, ctx);
    const reporter = await this.reporterFor(t);
    const assignee = t.assignedTo ? await this.staffUser(t.assignedTo, ctx) : null;
    const authors = new Map<HsHistoryItem, string | null>();
    for (const h of t.history) authors.set(h, await this.authorOf(h, t, reporter, ctx));

    // Anhänge vor der Transaktion laden (Anfragen an HelpSpot, Ablage)
    const files = t.history.flatMap((h) => h.files.map((file) => ({ file, item: h })));
    const known = files.length
      ? new Set(
          (
            await this.db
              .select({ externalId: attachments.externalId })
              .from(attachments)
              .where(inArray(attachments.externalId, files.map(({ file }) => docId(file))))
          ).map((r) => r.externalId),
        )
      : new Set<string | null>();
    const stored = new Map<string, { storageKey: string; size: number }>();
    for (const { file } of files) {
      if (known.has(docId(file)) || stored.has(docId(file))) continue;
      const data = await client.document(file.documentId);
      stored.set(docId(file), { storageKey: await this.storage.save(data), size: data.length });
    }

    const initial = t.history.find((h) => h.initial) ?? t.history[0];
    const times = t.history.map((h) => h.at?.getTime()).filter((ms): ms is number => !!ms);
    const createdAt = initial?.at ?? t.closedAt ?? new Date();
    const lastAt = times.length ? new Date(Math.max(...times)) : createdAt;
    const fields = {
      type,
      statusId,
      title: t.title || `HelpSpot ${t.number}`,
      priority: t.urgent ? ('high' as const) : ('normal' as const),
      reporterId: reporter.id,
      assigneeId: assignee?.id ?? null,
      channelId,
      closedAt: t.open ? null : lastAt,
      updatedAt: lastAt,
    };

    return this.db.transaction(async (tx) => {
      const [existing] = await tx
        .select()
        .from(items)
        .where(and(eq(items.prefix, HELPSPOT_PREFIX), eq(items.number, t.number)))
        .for('update')
        .limit(1);
      const [previous] = await tx.select().from(helpspotTickets).where(eq(helpspotTickets.number, t.number)).limit(1);
      let item: Item;
      if (!existing) {
        [item] = (await tx
          .insert(items)
          .values({
            ...fields,
            prefix: HELPSPOT_PREFIX,
            number: t.number,
            description: '',
            creatorId: reporter.id,
            source: /^e-?mail$/i.test(t.openedVia) ? 'mail' : 'internal',
            createdAt,
          })
          .returning()) as [Item];
      } else {
        item = existing;
        // In Patchwork seit dem letzten Import geändert (nach dem Umstieg): Angaben nicht überschreiben, nur ergänzen
        const changedHere = !previous || existing.updatedAt > previous.importedAt;
        if (!changedHere) [item] = (await tx.update(items).set(fields).where(eq(items.id, existing.id)).returning()) as [Item];
      }

      // Meldung: erster Eintrag mit seinen Anhängen
      if (initial && (!existing || !item.description)) {
        const inline = await this.saveFiles(tx, item.id, null, initial.files, stored);
        await tx
          .update(items)
          .set({ description: initial.html ? htmlToText(initial.note) : initial.note, descriptionHtml: initial.html ? sanitizeMailHtml(initial.note, inline) : null })
          .where(eq(items.id, item.id));
      }

      // Verlauf: je Eintrag aus HelpSpot einer in Patchwork, bereits übernommene bleiben
      const done = new Set(
        (
          await tx
            .select({ externalId: entries.externalId })
            .from(entries)
            .where(and(eq(entries.itemId, item.id), isNotNull(entries.externalId)))
        ).map((r) => r.externalId),
      );
      for (const h of t.history) {
        if (h === initial || done.has(entryId(h))) continue;
        // Ohne Text und ohne Anhang (z.B. nur ein Protokoll von HelpSpot) gibt es nichts zu zeigen
        if (!h.note.trim() && h.files.length === 0) continue;
        // Änderung ohne Inhalt, z.B. nur «Request Changed:»
        if (h.change && !changeText(h.note, h.html) && h.files.length === 0) continue;
        await this.addEntry(tx, item, h, authors.get(h) ?? null, stored);
      }

      await tx
        .insert(helpspotTickets)
        .values({
          number: t.number,
          itemId: item.id,
          raw,
          status: t.status,
          reporterName: [t.reporter.firstName, t.reporter.lastName].filter(Boolean).join(' '),
          messageId: initial?.messageId ?? null,
          importedAt: new Date(),
        })
        .onConflictDoUpdate({
          target: helpspotTickets.number,
          set: {
            itemId: item.id,
            raw,
            status: t.status,
            reporterName: sql`excluded.reporter_name`,
            messageId: sql`excluded.message_id`,
            importedAt: new Date(),
          },
        });
      return existing ? 'updated' : 'created';
    });
  }

  private async addEntry(tx: Tx, item: Item, h: HsHistoryItem, authorId: string | null, stored: Map<string, { storageKey: string; size: number }>) {
    const meta: Record<string, unknown> = { source: 'helpspot', helpspotId: h.id };
    if (!authorId && h.person) meta.authorName = h.person;
    const text = h.html ? htmlToText(h.note) : h.note;
    const [entry] = await tx
      .insert(entries)
      .values({
        itemId: item.id,
        authorId,
        kind: h.change ? 'change' : h.public ? 'reply' : 'note',
        body: h.change ? '' : text,
        meta: h.change ? { ...meta, field: 'helpspot', text: changeText(h.note, h.html) } : meta,
        externalId: entryId(h),
        createdAt: h.at ?? item.createdAt,
      })
      .returning();
    const inline = await this.saveFiles(tx, item.id, entry!.id, h.files, stored);
    if (h.html && !h.change) await tx.update(entries).set({ bodyHtml: sanitizeMailHtml(h.note, inline) }).where(eq(entries.id, entry!.id));
  }

  /** Anhänge eines Eintrags speichern; liefert die Adressen eingebetteter Bilder (cid → Adresse) */
  private async saveFiles(tx: Tx, itemId: string, entryIdValue: string | null, files: HsFile[], stored: Map<string, { storageKey: string; size: number }>) {
    const inline = new Map<string, string>();
    for (const file of files) {
      const content = stored.get(docId(file));
      if (!content) continue;
      const [row] = await tx
        .insert(attachments)
        .values({
          itemId,
          entryId: entryIdValue,
          filename: file.filename,
          contentType: file.mimeType,
          size: content.size,
          storageKey: content.storageKey,
          contentId: file.cid,
          externalId: docId(file),
        })
        .onConflictDoNothing({ target: attachments.externalId })
        .returning({ id: attachments.id });
      if (row && file.cid) inline.set(file.cid, `/api/attachments/${row.id}/inline`);
    }
    return inline;
  }

  /** Melder: Kontakt zur E-Mail-Adresse (ohne Abfrage im AD), ohne E-Mail ein gemeinsamer Kontakt */
  private reporterFor(t: HsTicket): Promise<User> {
    const name = [t.reporter.firstName, t.reporter.lastName].filter(Boolean).join(' ') || undefined;
    if (t.reporter.email && t.reporter.email.includes('@')) return this.users.findOrCreateContact(t.reporter.email, name);
    return this.users.findOrCreateContact(NO_EMAIL_CONTACT.email, NO_EMAIL_CONTACT.name);
  }

  /** Konto in Patchwork zu einer Person aus HelpSpot (über die E-Mail der Mitarbeitenden), sonst null */
  private async staffUser(name: string, ctx: RunContext): Promise<User | null> {
    const email = ctx.staffEmail.get(name.toLowerCase());
    if (!email) return null;
    if (!ctx.users.has(email)) ctx.users.set(email, (await this.users.findByEmail(email)) ?? null);
    return ctx.users.get(email) ?? null;
  }

  /** Autor eines Eintrags: Mitarbeitende mit Konto, der Melder, sonst niemand (der Name steht dann beim Eintrag) */
  private async authorOf(h: HsHistoryItem, t: HsTicket, reporter: User, ctx: RunContext): Promise<string | null> {
    if (h.personType === 'staff') return (await this.staffUser(h.person, ctx))?.id ?? null;
    if (h.personType === 'customer') {
      const reporterName = [t.reporter.firstName, t.reporter.lastName].filter(Boolean).join(' ').toLowerCase();
      return !h.person || h.person.toLowerCase() === reporterName ? reporter.id : null;
    }
    return null;
  }

  // ---------------------------------------------------------------- Kopien aus der Parallelphase

  /**
   * Vorgänge, die Patchwork während der Parallelphase aus derselben ersten Mail angelegt hat wie HelpSpot sein Ticket
   * (gleiche Message-ID), und die noch nicht mit dem HS-Vorgang verknüpft sind. Je Paar ein Vorschlag, welcher bleibt
   * (Entscheid vom 30.10.2026): die Kopie, wenn sie in Patchwork eine Aufgabe ist oder Antworten bzw. Notizen der IT
   * hat, sonst der HS-Vorgang.
   */
  async copies(): Promise<CopyPair[]> {
    const copy = alias(items, 'copy');
    const original = alias(items, 'original');
    const copyStatus = alias(statuses, 'copy_status');
    const originalStatus = alias(statuses, 'original_status');
    const rows = await this.db
      .select({
        copy: { id: copy.id, prefix: copy.prefix, number: copy.number, title: copy.title, type: copy.type, discarded: copy.discarded },
        copyStatus: { label: copyStatus.label, closed: copyStatus.closed },
        original: { id: original.id, prefix: original.prefix, number: original.number, title: original.title, type: original.type },
        originalStatus: { label: originalStatus.label, closed: originalStatus.closed },
        staffEntries: sql<number>`(
          select count(*)::int from ${entries} e join ${users} u on u.id = e.author_id
          where e.item_id = ${copy.id} and e.kind in ('reply', 'note') and u.role in ('it', 'admin')
        )`,
      })
      .from(helpspotTickets)
      .innerJoin(original, eq(original.id, helpspotTickets.itemId))
      .innerJoin(mailMessages, and(eq(mailMessages.messageId, helpspotTickets.messageId), eq(mailMessages.direction, 'in')))
      .innerJoin(copy, and(eq(copy.id, mailMessages.itemId), sql`${copy.prefix} <> ${HELPSPOT_PREFIX}`))
      .leftJoin(copyStatus, eq(copyStatus.id, copy.statusId))
      .leftJoin(originalStatus, eq(originalStatus.id, original.statusId))
      .where(
        sql`not exists (select 1 from ${links} l where (l.from_id = ${copy.id} and l.to_id = ${original.id}) or (l.from_id = ${original.id} and l.to_id = ${copy.id}))`,
      )
      .orderBy(copy.number);
    // Dieselbe Kopie nur einmal (eine Mail kann mehrfach im Protokoll stehen)
    const seen = new Set<string>();
    return rows
      .filter((r) => !seen.has(r.copy.id) && seen.add(r.copy.id))
      .map((r) => ({
        copy: { ...r.copy, status: r.copyStatus?.label ? r.copyStatus : null },
        original: { ...r.original, status: r.originalStatus?.label ? r.originalStatus : null },
        suggestion: suggestCopyKeep(r.copy, r.staffEntries),
      }));
  }

  /**
   * Paare bereinigen, ohne Mails: Der Vorgang, der nicht bleibt, wird geschlossen (im Eingang verworfen) und als Duplikat
   * mit dem bleibenden verknüpft. Ohne Auswahl gilt je Paar der Vorschlag; Paare, die in der Auswahl fehlen, bleiben
   * unverändert.
   */
  async resolveCopies(actor: User, choices?: CopyChoice[]): Promise<{ resolved: number; keptCopies: number }> {
    const pairs = await this.copies();
    const keep = new Map(choices ? choices.map((c) => [c.copyId, c.keep]) : pairs.map((p) => [p.copy.id, p.suggestion.keep]));
    const done: string[] = [];
    let keptCopies = 0;
    for (const pair of pairs) {
      const choice = keep.get(pair.copy.id);
      if (!choice) continue;
      const [duplicateId, survivorId] = choice === 'copy' ? [pair.original.id, pair.copy.id] : [pair.copy.id, pair.original.id];
      await this.db.transaction(async (tx) => {
        const [duplicate] = await tx.select().from(items).where(eq(items.id, duplicateId)).for('update').limit(1);
        const [survivor] = await tx.select().from(items).where(eq(items.id, survivorId)).limit(1);
        if (duplicate && survivor) await this.closeAsDuplicate(tx, duplicate, survivor, actor);
      });
      done.push(`${itemRef(choice === 'copy' ? pair.original : pair.copy)} → ${itemRef(choice === 'copy' ? pair.copy : pair.original)}`);
      if (choice === 'copy') keptCopies++;
    }
    this.logger.log(`Kopien aus der Parallelphase bereinigt: ${done.length} (${done.join(', ')})`);
    return { resolved: done.length, keptCopies };
  }

  /** Vorgang ohne Mails schliessen bzw. im Eingang verwerfen und als «Duplikat von» mit dem bleibenden verknüpfen */
  private async closeAsDuplicate(tx: Tx, duplicate: Item, survivor: Item, actor: User) {
    const now = new Date();
    if (!duplicate.type) {
      if (!duplicate.discarded) {
        await tx.update(items).set({ discarded: true, closedAt: now, updatedAt: now }).where(eq(items.id, duplicate.id));
        await this.items.addEntry(tx, duplicate.id, actor.id, 'change', '', { field: 'discarded' });
      }
    } else {
      const current = duplicate.statusId ? await this.statuses.get(duplicate.statusId, tx) : undefined;
      if (!current?.closed) {
        const target = await this.statuses.targetStatus(duplicate.type as ItemType, 'close', tx);
        await tx.update(items).set({ statusId: target.id, closedAt: now, updatedAt: now }).where(eq(items.id, duplicate.id));
        await this.items.addEntry(tx, duplicate.id, actor.id, 'status', '', {
          from: current?.label ?? null,
          to: target.label,
          ...referenceMeta('duplicateOf', survivor),
          merged: false,
        });
      }
    }
    await tx.insert(links).values({ fromId: duplicate.id, toId: survivor.id, kind: 'duplicate', createdById: actor.id });
    await this.items.addEntry(tx, duplicate.id, actor.id, 'change', '', {
      field: 'linkAdded',
      role: 'duplicateOf',
      roleLabel: LINK_ROLE_LABELS.duplicateOf,
      ...referenceMeta('other', survivor),
      otherTitle: survivor.title,
    });
    await this.items.addEntry(tx, survivor.id, actor.id, 'change', '', {
      field: 'linkAdded',
      role: 'hasDuplicate',
      roleLabel: LINK_ROLE_LABELS.hasDuplicate,
      ...referenceMeta('other', duplicate),
      otherTitle: duplicate.title,
    });
  }
}

const docId = (file: HsFile) => `hs-doc:${file.documentId}`;
const entryId = (h: HsHistoryItem) => `hs:${h.id}`;
