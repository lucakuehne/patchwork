import { BadRequestException, Body, Controller, Delete, Get, HttpCode, Post, UploadedFile, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { z } from 'zod';
import { AdminOnly } from '../auth/auth.decorators';
import { ZodPipe } from '../common/zod.pipe';
import type { UploadedFile as UploadedFileData } from '../items/items.service';
import { CertificateError, DNS_NAME } from './certificates';
import { TlsService } from './tls.service';

const requestSchema = z.object({
  names: z
    .array(
      z
        .string()
        .trim()
        .toLowerCase()
        .refine((name) => DNS_NAME.test(name), { message: 'Ungültiger Name, erwartet z.B. patchwork.firma.local' }),
    )
    .min(1, 'Mindestens ein Name')
    .max(10)
    .transform((names) => [...new Set(names)]),
});

/** HTTPS: Zertifikat anzeigen, Anforderung (CSR) erstellen, signiertes Zertifikat übernehmen. */
@AdminOnly()
@Controller('admin/tls')
export class TlsController {
  constructor(private readonly tls: TlsService) {}

  @Get()
  status() {
    return this.tls.status();
  }

  @Post('request')
  @HttpCode(200)
  createRequest(@Body(new ZodPipe(requestSchema)) body: z.infer<typeof requestSchema>) {
    return this.tls.createRequest(body.names);
  }

  @Delete('request')
  @HttpCode(200)
  discardRequest() {
    return this.tls.discardRequest();
  }

  @Post('certificate')
  @HttpCode(200)
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: 256 * 1024 } }))
  async install(@UploadedFile() file: UploadedFileData | undefined) {
    if (!file) throw new BadRequestException('Keine Datei erhalten');
    try {
      return await this.tls.install(file.buffer);
    } catch (err) {
      if (err instanceof CertificateError) throw new BadRequestException(err.message);
      throw err;
    }
  }
}
