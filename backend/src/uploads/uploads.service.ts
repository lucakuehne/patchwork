import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { and, eq, lt } from 'drizzle-orm';
import { InjectDb, type Db } from '../db/db.module';
import { uploads, type User } from '../db/schema';
import { MAX_IMAGE_BYTES, sniffImage } from '../items/inline-images';
import { decodeFilename, type UploadedFile } from '../items/items.service';
import { StorageService } from '../storage/storage.service';

/** Liegengebliebene Bilder (nie gespeicherte Entwürfe) löscht die Wartung nach einem Tag. */
const KEEP_MS = 24 * 60 * 60 * 1000;

/** Bilder, die im Editor eingefügt werden, bevor der Text gespeichert ist. */
@Injectable()
export class UploadsService {
  private readonly logger = new Logger(UploadsService.name);

  constructor(
    @InjectDb() private readonly db: Db,
    private readonly storage: StorageService,
  ) {}

  async saveImage(user: User, file: UploadedFile): Promise<{ id: string; ref: string }> {
    if (file.size > MAX_IMAGE_BYTES) {
      throw new BadRequestException('Bilder im Text dürfen höchstens 10 MB gross sein. Grössere Dateien bitte als Anhang.');
    }
    const contentType = sniffImage(file.buffer);
    if (!contentType) throw new BadRequestException('Im Text gehen nur Bilder als PNG, JPEG, GIF oder WebP.');
    const storageKey = await this.storage.save(file.buffer);
    const [row] = await this.db
      .insert(uploads)
      .values({
        userId: user.id,
        filename: decodeFilename(file.originalname).slice(0, 255) || 'bild',
        contentType,
        size: file.size,
        storageKey,
      })
      .returning();
    return { id: row!.id, ref: `upload:${row!.id}` };
  }

  /** Nur wer das Bild hochgeladen hat, sieht es vor dem Speichern. */
  async get(user: User, id: string) {
    const [row] = await this.db
      .select()
      .from(uploads)
      .where(and(eq(uploads.id, id), eq(uploads.userId, user.id)))
      .limit(1);
    if (!row) throw new NotFoundException('Bild nicht gefunden');
    return row;
  }

  async purgeOld(): Promise<void> {
    const old = await this.db
      .delete(uploads)
      .where(lt(uploads.createdAt, new Date(Date.now() - KEEP_MS)))
      .returning();
    for (const row of old) await this.storage.remove(row.storageKey).catch(() => undefined);
    if (old.length) this.logger.log(`${old.length} nicht verwendete Bilder entfernt`);
  }
}
