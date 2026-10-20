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
import { and, eq } from 'drizzle-orm';
import type { Response } from 'express';
import { simpleParser } from 'mailparser';
import { z } from 'zod';
import { CurrentUser } from '../auth/auth.decorators';
import { appConfig } from '../config';
import { emailSchema, nullableUuid, ZodPipe } from '../common/zod.pipe';
import { InjectDb, type Db } from '../db/db.module';
import { attachments, mailMessages, type User } from '../db/schema';
import { itemRef } from '../mail/mail-content';
import { mailView, sendMailAttachment } from '../mail/mail-view';
import { sendAttachment } from '../storage/attachment-response';
import { StorageService } from '../storage/storage.service';
import { ChecklistsService } from './checklists.service';
import { VIEWS } from './item-views';
import { ItemsService, type UploadedFile } from './items.service';
import { LinksService } from './links.service';

const typeSchema = z.enum(['incident', 'task']);
const prioritySchema = z.enum(['high', 'normal', 'low']);
const titleSchema = z.string().trim().min(1, 'Titel fehlt').max(500);
/** Formular-Uploads liefern Zeilenumbrüche als CRLF */
const normalizeNewlines = (s: string) => s.replace(/\r\n?/g, '\n');
const descriptionSchema = z.string().max(100000).transform(normalizeNewlines);

const listSchema = z.object({
  view: z.enum(VIEWS),
  mine: z
    .enum(['0', '1', 'true', 'false'])
    .optional()
    .transform((v) => v === '1' || v === 'true'),
  q: z.string().max(200).default(''),
  limit: z.coerce.number().int().min(1).max(200).default(50),
  offset: z.coerce.number().int().min(0).default(0),
});

const createSchema = z.object({
  type: typeSchema,
  title: titleSchema,
  description: z.string().max(100000).default('').transform(normalizeNewlines),
  priority: prioritySchema.default('normal'),
  reporterId: nullableUuid.optional(),
  assigneeId: nullableUuid.optional(),
  statusId: nullableUuid.optional(),
});

const updateSchema = z.object({
  title: titleSchema.optional(),
  description: descriptionSchema.optional(),
  priority: prioritySchema.optional(),
  assigneeId: nullableUuid.optional(),
  reporterId: z.uuid().optional(),
  mailboxId: nullableUuid.optional(),
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
});

const noteEditSchema = z.object({ body: z.string().max(100000).transform(normalizeNewlines) });

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
  ) {}

  @Get('items')
  list(@Query(new ZodPipe(listSchema)) query: z.infer<typeof listSchema>, @CurrentUser() user: User) {
    return this.items.list(query.view, { ...query, userId: user.id });
  }

  @Get('items/counts')
  counts() {
    return this.items.counts();
  }

  @Post('items')
  @UseInterceptors(uploads())
  async create(
    @Body(new ZodPipe(createSchema)) body: z.infer<typeof createSchema>,
    @UploadedFiles() files: UploadedFile[] | undefined,
    @CurrentUser() user: User,
  ) {
    const item = await this.items.createInternal(user, body, files ?? []);
    return { number: item.number };
  }

  @Get('items/:number')
  async detail(@Param('number', ParseIntPipe) number: number, @CurrentUser() user: User) {
    const item = await this.items.detail(number, user);
    return {
      ...item,
      links: await this.links.forItem(item.id),
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
    @Body(new ZodPipe(z.object({ type: typeSchema }))) body: { type: 'incident' | 'task' },
    @CurrentUser() user: User,
  ) {
    await this.items.setType(user, number, body.type);
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
    await this.items.comment(user, number, body.kind, body.body, files ?? []);
  }

  @Patch('entries/:id')
  @HttpCode(204)
  async editNote(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodPipe(noteEditSchema)) body: z.infer<typeof noteEditSchema>,
    @CurrentUser() user: User,
  ) {
    await this.items.editNote(user, id, body.body);
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

  @Get('items/:number/original/attachments/:index')
  async originalAttachment(
    @Param('number', ParseIntPipe) number: number,
    @Param('index', ParseIntPipe) index: number,
    @Query('messageId') messageId: string,
    @Res() res: Response,
  ) {
    const { storageKey } = await this.originalMail(number, messageId);
    if (!sendMailAttachment(await simpleParser(await this.readStored(storageKey)), index, res)) {
      throw new NotFoundException('Anhang nicht gefunden');
    }
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
        throw new NotFoundException('Die Originalmail ist nicht mehr vorhanden (Datei fehlt in der Ablage)');
      }
      throw err;
    }
  }

  @Get('attachments/:id')
  download(@Param('id', ParseUUIDPipe) id: string, @Res() res: Response) {
    return this.sendAttachment(id, res, false);
  }

  /** Bilder zur Anzeige im Browser (eingebettete Mail-Bilder, Vorschau). Andere Typen werden heruntergeladen. */
  @Get('attachments/:id/inline')
  inline(@Param('id', ParseUUIDPipe) id: string, @Res() res: Response) {
    return this.sendAttachment(id, res, true);
  }

  private async sendAttachment(id: string, res: Response, inline: boolean) {
    const [att] = await this.db.select().from(attachments).where(eq(attachments.id, id)).limit(1);
    if (!att) throw new NotFoundException('Anhang nicht gefunden');
    sendAttachment(this.storage, att, res, inline);
  }
}
