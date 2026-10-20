import { BadRequestException, Controller, Get, Param, ParseUUIDPipe, Post, Res, UploadedFile, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import type { Response } from 'express';
import { CurrentUser, PortalRoute } from '../auth/auth.decorators';
import { appConfig } from '../config';
import type { User } from '../db/schema';
import type { UploadedFile as UploadedFileData } from '../items/items.service';
import { sendAttachment } from '../storage/attachment-response';
import { StorageService } from '../storage/storage.service';
import { UploadsService } from './uploads.service';

/** Bilder im Text: Hochladen aus dem Editor (auch im Portal) und Anzeige für die hochladende Person. */
@PortalRoute()
@Controller('uploads')
export class UploadsController {
  constructor(
    private readonly uploads: UploadsService,
    private readonly storage: StorageService,
  ) {}

  /** Grösse prüft der Dienst selbst, damit die Meldung verständlich ist */
  @Post('images')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: appConfig.maxUploadBytes } }))
  async upload(@UploadedFile() file: UploadedFileData | undefined, @CurrentUser() user: User) {
    if (!file) throw new BadRequestException('Keine Datei erhalten');
    return this.uploads.saveImage(user, file);
  }

  @Get(':id')
  async show(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: User, @Res() res: Response) {
    sendAttachment(this.storage, await this.uploads.get(user, id), res, true);
  }
}
