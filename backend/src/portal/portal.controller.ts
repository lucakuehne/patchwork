import {
  Body,
  Controller,
  Get,
  HttpCode,
  NotFoundException,
  Param,
  ParseIntPipe,
  ParseUUIDPipe,
  Post,
  Query,
  Res,
  UploadedFiles,
  UseInterceptors,
} from '@nestjs/common';
import { FilesInterceptor } from '@nestjs/platform-express';
import type { Response } from 'express';
import { z } from 'zod';
import { CurrentUser, PortalRoute } from '../auth/auth.decorators';
import { appConfig } from '../config';
import { ZodPipe } from '../common/zod.pipe';
import type { User } from '../db/schema';
import { ItemsService, type UploadedFile } from '../items/items.service';
import { RulesService } from '../rules/rules.service';
import { buildPreview, nestedAttachment, sendFile } from '../storage/attachment-preview';
import { sendAttachment } from '../storage/attachment-response';
import { StorageService } from '../storage/storage.service';
import { PortalService } from './portal.service';

const normalizeNewlines = (s: string) => s.replace(/\r\n?/g, '\n');

const createSchema = z.object({
  /** «Etwas funktioniert nicht» = incident, «Ich brauche etwas» = task */
  type: z.enum(['incident', 'task']),
  title: z.string().trim().min(1, 'Titel fehlt').max(500),
  description: z.string().max(100000).default('').transform(normalizeNewlines),
});

const replySchema = z.object({ body: z.string().max(100000).default('').transform(normalizeNewlines) });
const listSchema = z.object({ state: z.enum(['open', 'closed']).default('open') });

const uploads = () =>
  FilesInterceptor('files', 20, { limits: { fileSize: appConfig.maxUploadBytes, files: 20 } });

/** Portal für Melder: nur die eigenen Vorgänge. */
@PortalRoute()
@Controller('portal')
export class PortalController {
  constructor(
    private readonly portal: PortalService,
    private readonly items: ItemsService,
    private readonly rules: RulesService,
    private readonly storage: StorageService,
  ) {}

  @Get('items')
  list(@Query(new ZodPipe(listSchema)) query: z.infer<typeof listSchema>, @CurrentUser() user: User) {
    return this.portal.list(user, query.state);
  }

  @Get('items/:number')
  detail(@Param('number', ParseIntPipe) number: number, @CurrentUser() user: User) {
    return this.portal.detail(user, number);
  }

  @Post('items')
  @UseInterceptors(uploads())
  async create(
    @Body(new ZodPipe(createSchema)) body: z.infer<typeof createSchema>,
    @UploadedFiles() files: UploadedFile[] | undefined,
    @CurrentUser() user: User,
  ) {
    const run = await this.rules.prepare('portal_new', {
      sender: user.email,
      subject: body.title,
      body: body.description,
      mailboxId: null,
    });
    const item = await this.items.createFromPortal(
      user,
      { suggestedType: body.type, title: body.title, description: body.description },
      files ?? [],
      run,
    );
    return { number: item.number };
  }

  @Post('items/:number/replies')
  @HttpCode(204)
  @UseInterceptors(uploads())
  async reply(
    @Param('number', ParseIntPipe) number: number,
    @Body(new ZodPipe(replySchema)) body: z.infer<typeof replySchema>,
    @UploadedFiles() files: UploadedFile[] | undefined,
    @CurrentUser() user: User,
  ) {
    // Regeln nur für eigene Vorgänge prüfen; fremde lehnt portalReply ab
    const target = await this.items.byNumber(number).catch(() => null);
    const run =
      target && target.reporterId === user.id
        ? await this.rules.prepare('portal_reply', { sender: user.email, subject: target.title, body: body.body, mailboxId: null })
        : undefined;
    await this.items.portalReply(user, number, body.body, files ?? [], run);
  }

  @Get('attachments/:id')
  async download(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: User, @Res() res: Response) {
    sendAttachment(this.storage, await this.portal.attachment(user, id), res, false);
  }

  @Get('attachments/:id/inline')
  async inline(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: User, @Res() res: Response) {
    sendAttachment(this.storage, await this.portal.attachment(user, id), res, true);
  }

  /** Vorschau eines eigenen Anhangs (wie in Patchwork) */
  @Get('attachments/:id/preview')
  async preview(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: User) {
    const att = await this.portal.attachment(user, id);
    const preview = await buildPreview({ ...att, content: await this.storage.read(att.storageKey) });
    if (!preview) throw new NotFoundException('Für diesen Dateityp gibt es keine Vorschau');
    return preview;
  }

  @Get('attachments/:id/mail-attachments/:index')
  async nested(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('index', ParseIntPipe) index: number,
    @CurrentUser() user: User,
    @Res() res: Response,
  ) {
    const att = await this.portal.attachment(user, id);
    const file = await nestedAttachment({ ...att, content: await this.storage.read(att.storageKey) }, index);
    if (!file) throw new NotFoundException('Anhang nicht gefunden');
    sendFile(res, file, false);
  }
}
