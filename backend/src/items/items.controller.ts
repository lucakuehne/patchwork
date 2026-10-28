import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  NotFoundException,
  Param,
  ParseIntPipe,
  ParseUUIDPipe,
  Patch,
  Post,
  Put,
  Query,
  Res,
  UploadedFiles,
  UseInterceptors,
} from '@nestjs/common';
import { FilesInterceptor } from '@nestjs/platform-express';
import { and, eq, or } from 'drizzle-orm';
import type { Response } from 'express';
import { simpleParser } from 'mailparser';
import { z } from 'zod';
import { AdminOnly, CurrentUser } from '../auth/auth.decorators';
import { appConfig } from '../config';
import { emailSchema, nullableUuid, ZodPipe } from '../common/zod.pipe';
import { InjectDb, type Db } from '../db/db.module';
import { attachments, entries, mailMessages, outgoingMails, type User } from '../db/schema';
import { itemRef } from '../mail/mail-content';
import { templateByKey } from '../mail/mail-templates';
import { AreasService } from '../settings/areas';
import { disposition, mailAttachmentPreview, mailView, sendMailAttachment } from '../mail/mail-view';
import { buildPreview, nestedAttachment, sendFile } from '../storage/attachment-preview';
import { sendAttachment } from '../storage/attachment-response';
import { StorageService } from '../storage/storage.service';
import { ChecklistsService } from './checklists.service';
import { SORT_FIELDS, VIEWS } from './item-views';
import { ItemsService, type UploadedFile } from './items.service';
import { LinksService } from './links.service';

const typeSchema = z.enum(['incident', 'task']);
const prioritySchema = z.enum(['high', 'normal', 'low']);
const titleSchema = z.string().trim().min(1, 'Titel fehlt').max(500);
/** Formular-Uploads liefern Zeilenumbrüche als CRLF */
const normalizeNewlines = (s: string) => s.replace(/\r\n?/g, '\n');
const descriptionSchema = z.string().max(100000).transform(normalizeNewlines);
/** Datum ohne Uhrzeit (JJJJ-MM-TT); leer = keines */
const dueDateSchema = z.preprocess(
  (v) => (v === '' ? null : v),
  z.iso.date({ error: 'Ungültiges Fälligkeitsdatum' }).nullable(),
);

const listSchema = z.object({
  view: z.enum(VIEWS),
  mine: z
    .enum(['0', '1', 'true', 'false'])
    .optional()
    .transform((v) => v === '1' || v === 'true'),
  q: z.string().max(200).default(''),
  limit: z.coerce.number().int().min(1).max(200).default(50),
  offset: z.coerce.number().int().min(0).default(0),
  // Filter der Liste; «none» = ohne Zuständigen bzw. ohne Meldeweg
  priority: prioritySchema.optional(),
  assignee: z.union([z.literal('none'), z.uuid()]).optional(),
  status: z.uuid().optional(),
  channel: z.union([z.literal('none'), z.uuid()]).optional(),
  sort: z.enum(SORT_FIELDS).optional(),
  dir: z.enum(['asc', 'desc']).default('asc'),
});

const createSchema = z.object({
  type: typeSchema,
  title: titleSchema,
  description: z.string().max(100000).default('').transform(normalizeNewlines),
  priority: prioritySchema.default('normal'),
  reporterId: nullableUuid.optional(),
  assigneeId: nullableUuid.optional(),
  statusId: nullableUuid.optional(),
  /** Meldeweg, Pflicht beim internen Erfassen */
  channelId: z.uuid({ error: 'Bitte den Meldeweg wählen.' }),
  dueDate: dueDateSchema.optional(),
});

const updateSchema = z.object({
  title: titleSchema.optional(),
  description: descriptionSchema.optional(),
  priority: prioritySchema.optional(),
  assigneeId: nullableUuid.optional(),
  reporterId: z.uuid().optional(),
  mailboxId: nullableUuid.optional(),
  channelId: z.uuid().optional(),
  dueDate: dueDateSchema.optional(),
});

const typeChangeSchema = z.object({
  type: typeSchema,
  /** Status im neuen Typ; ohne Angabe der Vorschlag nach der Rolle des bisherigen Status (aus dem Eingang: Start) */
  statusId: nullableUuid.optional(),
});

const moveSchema = z.object({
  statusId: z.uuid(),
  beforeId: nullableUuid.optional(),
  afterId: nullableUuid.optional(),
  /** Abschliessen trotz offener Checklisten-Punkte bestätigt */
  force: z.boolean().default(false),
});

const rejectSchema = z.object({
  reason: z.string().trim().min(1, 'Begründung fehlt').max(20000).transform(normalizeNewlines),
  notify: z.boolean().default(false),
});

const commentSchema = z.object({
  kind: z.enum(['reply', 'note']),
  body: z.string().max(100000).default('').transform(normalizeNewlines),
  /** Nur Admins: im Namen dieses IT-Mitarbeitenden oder Admins schreiben (Entscheid vom 28.10.2026) */
  asUserId: z.uuid('Ungültiger Benutzer').optional(),
});

const noteEditSchema = z.object({ body: z.string().max(100000).transform(normalizeNewlines) });
const noteTimeSchema = z.object({ at: z.iso.datetime({ offset: true, error: 'Ungültige Zeit' }) });

const participantSchema = z.object({ email: emailSchema, name: z.string().trim().max(200).optional() });

const uploads = () =>
  FilesInterceptor('files', 20, { limits: { fileSize: appConfig.maxUploadBytes, files: 20 } });

@Controller()
export class ItemsController {
  constructor(
    @InjectDb() private readonly db: Db,
    private readonly items: ItemsService,
    private readonly links: LinksService,
    private readonly checklists: ChecklistsService,
    private readonly storage: StorageService,
    private readonly areas: AreasService,
  ) {}

  // Routen mit «:number» prüft der AuthGuard auf die Bereiche des Benutzers (Bereiche je Rolle), die übrigen hier

  @Get('items')
  async list(@Query(new ZodPipe(listSchema)) query: z.infer<typeof listSchema>, @CurrentUser() user: User) {
    const { priority, assignee, status, channel, sort, dir } = query;
    return this.items.list(query.view, {
      ...query,
      userId: user.id,
      areas: await this.areas.limit(user),
      filters: { priority, assignee, status, channel },
      sort: sort ? { field: sort, dir } : undefined,
    });
  }

  @Get('items/counts')
  async counts(@CurrentUser() user: User) {
    return this.items.counts(await this.areas.limit(user));
  }

  @Post('items')
  @UseInterceptors(uploads())
  async create(
    @Body(new ZodPipe(createSchema)) body: z.infer<typeof createSchema>,
    @UploadedFiles() files: UploadedFile[] | undefined,
    @CurrentUser() user: User,
  ) {
    await this.areas.assertType(user, body.type);
    const item = await this.items.createInternal(user, body, files ?? []);
    return { number: item.number };
  }

  @Get('items/:number')
  async detail(@Param('number', ParseIntPipe) number: number, @CurrentUser() user: User) {
    const item = await this.items.detail(number, user);
    return {
      ...item,
      links: await this.links.forItem(item.id, await this.areas.limit(user)),
      // Checklisten gibt es nur bei Aufgaben; bei Störungen bleiben sie gespeichert, aber ausgeblendet
      checklists: item.type === 'task' ? await this.checklists.forItem(item.id) : [],
    };
  }

  @Patch('items/:number')
  @HttpCode(204)
  async update(
    @Param('number', ParseIntPipe) number: number,
    @Body(new ZodPipe(updateSchema)) body: z.infer<typeof updateSchema>,
    @CurrentUser() user: User,
  ) {
    await this.items.update(user, number, body);
  }

  @Post('items/:number/type')
  @HttpCode(204)
  async setType(
    @Param('number', ParseIntPipe) number: number,
    @Body(new ZodPipe(typeChangeSchema)) body: z.infer<typeof typeChangeSchema>,
    @CurrentUser() user: User,
  ) {
    // Nur in einen Bereich, den man selbst sieht (Entscheid vom 23.10.2026)
    await this.areas.assertType(user, body.type);
    await this.items.setType(user, number, body.type, body.statusId);
  }

  @Post('items/:number/move')
  @HttpCode(204)
  async move(
    @Param('number', ParseIntPipe) number: number,
    @Body(new ZodPipe(moveSchema)) body: z.infer<typeof moveSchema>,
    @CurrentUser() user: User,
  ) {
    await this.items.move(user, number, body.statusId, body.beforeId ?? null, body.afterId ?? null, body.force);
  }

  @Post('items/:number/reject')
  @HttpCode(204)
  async reject(
    @Param('number', ParseIntPipe) number: number,
    @Body(new ZodPipe(rejectSchema)) body: z.infer<typeof rejectSchema>,
    @CurrentUser() user: User,
  ) {
    await this.items.reject(user, number, body.reason, body.notify);
  }

  @Post('items/:number/discard')
  @HttpCode(204)
  async discard(
    @Param('number', ParseIntPipe) number: number,
    @Body(new ZodPipe(z.object({ discarded: z.boolean() }))) body: { discarded: boolean },
    @CurrentUser() user: User,
  ) {
    await this.items.setDiscarded(user, number, body.discarded);
  }

  @Post('items/:number/entries')
  @HttpCode(204)
  @UseInterceptors(uploads())
  async comment(
    @Param('number', ParseIntPipe) number: number,
    @Body(new ZodPipe(commentSchema)) body: z.infer<typeof commentSchema>,
    @UploadedFiles() files: UploadedFile[] | undefined,
    @CurrentUser() user: User,
  ) {
    await this.items.comment(user, number, body.kind, body.body, files ?? [], body.asUserId);
  }

  @Patch('entries/:id')
  @HttpCode(204)
  async editNote(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodPipe(noteEditSchema)) body: z.infer<typeof noteEditSchema>,
    @CurrentUser() user: User,
  ) {
    const [entry] = await this.db.select({ itemId: entries.itemId }).from(entries).where(eq(entries.id, id)).limit(1);
    if (entry) await this.areas.assertItem(user, entry.itemId);
    await this.items.editNote(user, id, body.body);
  }

  /** Zeit einer internen Notiz anpassen, nur Admins (Entscheid vom 27.10.2026) */
  @Patch('entries/:id/time')
  @AdminOnly()
  @HttpCode(204)
  async setNoteTime(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodPipe(noteTimeSchema)) body: z.infer<typeof noteTimeSchema>,
    @CurrentUser() user: User,
  ) {
    const [entry] = await this.db.select({ itemId: entries.itemId }).from(entries).where(eq(entries.id, id)).limit(1);
    if (entry) await this.areas.assertItem(user, entry.itemId);
    await this.items.setNoteTime(user, id, new Date(body.at));
  }

  @Post('items/:number/participants')
  @HttpCode(204)
  async addParticipant(
    @Param('number', ParseIntPipe) number: number,
    @Body(new ZodPipe(participantSchema)) body: z.infer<typeof participantSchema>,
    @CurrentUser() user: User,
  ) {
    await this.items.addParticipant(user, number, body.email, body.name);
  }

  @Delete('items/:number/participants/:userId')
  @HttpCode(204)
  async removeParticipant(
    @Param('number', ParseIntPipe) number: number,
    @Param('userId', ParseUUIDPipe) userId: string,
    @CurrentUser() user: User,
  ) {
    await this.items.removeParticipant(user, number, userId);
  }

  @Put('items/:number/mute')
  @HttpCode(204)
  async mute(
    @Param('number', ParseIntPipe) number: number,
    @Body(new ZodPipe(z.object({ muted: z.boolean() }))) body: { muted: boolean },
    @CurrentUser() user: User,
  ) {
    await this.items.setMuted(user, number, body.muted);
  }

  /** Originalmail (.eml) einer eingehenden Nachricht. */
  @Get('items/:number/original')
  async original(
    @Param('number', ParseIntPipe) number: number,
    @Query('messageId') messageId: string,
    @Res() res: Response,
  ) {
    const { item, storageKey } = await this.originalMail(number, messageId);
    res.setHeader('Content-Type', 'message/rfc822');
    res.setHeader('Content-Disposition', `attachment; filename="${itemRef(item.number)}.eml"`);
    res.setHeader('X-Content-Type-Options', 'nosniff');
    this.storage
      .stream(storageKey)
      .on('error', () => res.status(404).end())
      .pipe(res);
  }

  /** Originalmail zum Anschauen: Kopf, bereinigtes HTML (ohne externe Bilder) bzw. Text und Anhänge. */
  @Get('items/:number/original/view')
  async originalView(@Param('number', ParseIntPipe) number: number, @Query('messageId') messageId: string) {
    const { item, storageKey } = await this.originalMail(number, messageId);
    const query = `?messageId=${encodeURIComponent(messageId)}`;
    return mailView(await this.readStored(storageKey), (index) => `/api/items/${item.number}/original/attachments/${index}${query}`, true);
  }

  /** Anhang der Originalmail; «inline=1» zeigt Bilder und PDF im Browser an (Vorschau). */
  @Get('items/:number/original/attachments/:index')
  async originalAttachment(
    @Param('number', ParseIntPipe) number: number,
    @Param('index', ParseIntPipe) index: number,
    @Query('messageId') messageId: string,
    @Query('inline') inline: string | undefined,
    @Res() res: Response,
  ) {
    const { storageKey } = await this.originalMail(number, messageId);
    if (!sendMailAttachment(await simpleParser(await this.readStored(storageKey)), index, res, inline === '1')) {
      throw new NotFoundException('Anhang nicht gefunden');
    }
  }

  @Get('items/:number/original/attachments/:index/preview')
  async originalAttachmentPreview(
    @Param('number', ParseIntPipe) number: number,
    @Param('index', ParseIntPipe) index: number,
    @Query('messageId') messageId: string,
  ) {
    const { storageKey } = await this.originalMail(number, messageId);
    return mailAttachmentPreview(await simpleParser(await this.readStored(storageKey)), index);
  }

  /** Eine von Patchwork zu diesem Vorgang versendete Mail, so wie sie (ohne Testbetrieb) versendet wird. */
  @Get('items/:number/mails/:id')
  async sentMail(@Param('number', ParseIntPipe) number: number, @Param('id', ParseUUIDPipe) id: string) {
    const { item, mail } = await this.sentMailRow(number, id);
    // Eigenes HTML; eingebettete Bilder («cid:») zeigen auf die Anhänge der gespeicherten Mail
    const view = await mailView(await this.readStored(mail.storageKey), (index) => `/api/items/${item.number}/mails/${mail.id}/attachments/${index}`, false);
    return {
      id: mail.id,
      label: mail.entryId ? 'Öffentliche Antwort' : (templateByKey(mail.template ?? '')?.label ?? 'Automatische Mail'),
      createdAt: mail.createdAt,
      sentAt: mail.sentAt,
      status: mail.status,
      fromAddress: mail.fromAddress,
      to: mail.to,
      cc: mail.cc,
      deliveredTo: mail.deliveredTo,
      subject: mail.subject,
      error: mail.error,
      text: view.text,
      html: view.html,
      attachments: view.attachments,
    };
  }

  @Get('items/:number/mails/:id/eml')
  async sentMailEml(@Param('number', ParseIntPipe) number: number, @Param('id', ParseUUIDPipe) id: string, @Res() res: Response) {
    const { mail } = await this.sentMailRow(number, id);
    res.setHeader('Content-Type', 'message/rfc822');
    res.setHeader('Content-Disposition', disposition(`${mail.subject || 'Mail'}.eml`));
    res.setHeader('X-Content-Type-Options', 'nosniff');
    this.storage
      .stream(mail.storageKey)
      .on('error', () => res.status(404).end())
      .pipe(res);
  }

  @Get('items/:number/mails/:id/attachments/:index')
  async sentMailAttachment(
    @Param('number', ParseIntPipe) number: number,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('index', ParseIntPipe) index: number,
    @Query('inline') inline: string | undefined,
    @Res() res: Response,
  ) {
    const { mail } = await this.sentMailRow(number, id);
    if (!sendMailAttachment(await simpleParser(await this.readStored(mail.storageKey)), index, res, inline === '1')) {
      throw new NotFoundException('Anhang nicht gefunden');
    }
  }

  @Get('items/:number/mails/:id/attachments/:index/preview')
  async sentMailAttachmentPreview(
    @Param('number', ParseIntPipe) number: number,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('index', ParseIntPipe) index: number,
  ) {
    const { mail } = await this.sentMailRow(number, id);
    return mailAttachmentPreview(await simpleParser(await this.readStored(mail.storageKey)), index);
  }

  private async sentMailRow(number: number, id: string) {
    const item = await this.items.byNumber(number);
    const [mail] = await this.db
      .select()
      .from(outgoingMails)
      .where(and(eq(outgoingMails.id, id), or(eq(outgoingMails.itemId, item.id), eq(outgoingMails.relatedItemId, item.id))))
      .limit(1);
    if (!mail) throw new NotFoundException('Mail nicht gefunden');
    return { item, mail };
  }

  private async originalMail(number: number, messageId: string | undefined) {
    const item = await this.items.byNumber(number);
    const [row] = await this.db
      .select()
      .from(mailMessages)
      .where(and(eq(mailMessages.itemId, item.id), eq(mailMessages.messageId, messageId ?? '')))
      .limit(1);
    if (!row?.storageKey) throw new NotFoundException('Originalmail nicht gefunden');
    return { item, storageKey: row.storageKey };
  }

  private async readStored(storageKey: string): Promise<Buffer> {
    try {
      return await this.storage.read(storageKey);
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
        throw new NotFoundException('Die gespeicherte Datei ist nicht mehr vorhanden (fehlt in der Ablage)');
      }
      throw err;
    }
  }

  @Get('attachments/:id')
  download(@Param('id', ParseUUIDPipe) id: string, @Res() res: Response, @CurrentUser() user: User) {
    return this.sendAttachment(user, id, res, false);
  }

  /** Bilder zur Anzeige im Browser (eingebettete Mail-Bilder, Vorschau). Andere Typen werden heruntergeladen. */
  @Get('attachments/:id/inline')
  inline(@Param('id', ParseUUIDPipe) id: string, @Res() res: Response, @CurrentUser() user: User) {
    return this.sendAttachment(user, id, res, true);
  }

  /** Vorschau eines Anhangs: Text und Mails aufbereitet, für Bilder und PDF nur die Art (die zeigt der Browser) */
  @Get('attachments/:id/preview')
  async preview(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: User) {
    const att = await this.attachment(user, id);
    const preview = await buildPreview({ ...att, content: await this.readStored(att.storageKey) });
    if (!preview) throw new NotFoundException('Für diesen Dateityp gibt es keine Vorschau');
    return preview;
  }

  /** Anhang einer Mail, die selbst ein Anhang ist (.eml, .msg), zum Herunterladen aus der Vorschau */
  @Get('attachments/:id/mail-attachments/:index')
  async nested(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('index', ParseIntPipe) index: number,
    @Res() res: Response,
    @CurrentUser() user: User,
  ) {
    const att = await this.attachment(user, id);
    const file = await nestedAttachment({ ...att, content: await this.readStored(att.storageKey) }, index);
    if (!file) throw new NotFoundException('Anhang nicht gefunden');
    sendFile(res, file, false);
  }

  /** Anhang über seine ID, nur in den Bereichen des Benutzers */
  private async attachment(user: User, id: string) {
    const [att] = await this.db.select().from(attachments).where(eq(attachments.id, id)).limit(1);
    if (!att) throw new NotFoundException('Anhang nicht gefunden');
    await this.areas.assertItem(user, att.itemId);
    return att;
  }

  private async sendAttachment(user: User, id: string, res: Response, inline: boolean) {
    sendAttachment(this.storage, await this.attachment(user, id), res, inline);
  }
}
