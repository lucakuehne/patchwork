import { Controller, Get, NotFoundException, Param, ParseUUIDPipe, Query, Res } from '@nestjs/common';
import { and, eq, isNotNull } from 'drizzle-orm';
import type { Response } from 'express';
import { Public } from '../auth/auth.decorators';
import { verifySignature } from '../common/crypto';
import { InjectDb, type Db } from '../db/db.module';
import { attachments } from '../db/schema';
import { sendAttachment } from '../storage/attachment-response';
import { StorageService } from '../storage/storage.service';

/**
 * Bilder aus Mails in voller Grösse, ohne Anmeldung (auch für Beteiligte ohne Zugang zum Portal). Die Mail enthält das
 * Bild ohnehin; der Link ist signiert und gilt nur für eingebettete Bilder.
 */
@Public()
@Controller('public/images')
export class PublicImagesController {
  constructor(
    @InjectDb() private readonly db: Db,
    private readonly storage: StorageService,
  ) {}

  @Get(':id')
  async show(@Param('id', ParseUUIDPipe) id: string, @Query('s') signature: string | undefined, @Res() res: Response) {
    if (!signature || !verifySignature('image', id, signature)) throw new NotFoundException('Bild nicht gefunden');
    const [att] = await this.db
      .select()
      .from(attachments)
      .where(and(eq(attachments.id, id), isNotNull(attachments.contentId)))
      .limit(1);
    if (!att) throw new NotFoundException('Bild nicht gefunden');
    sendAttachment(this.storage, att, res, true);
  }
}
