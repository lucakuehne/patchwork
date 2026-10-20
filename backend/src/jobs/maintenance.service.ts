import { Injectable, OnModuleInit } from '@nestjs/common';
import { SessionService } from '../auth/session.service';
import { UploadsService } from '../uploads/uploads.service';
import { BossService, QUEUE_MAINTENANCE } from './boss.service';

/** Nächtliche Aufräumarbeiten: abgelaufene Sitzungen, nie gespeicherte Bilder aus dem Editor. */
@Injectable()
export class MaintenanceService implements OnModuleInit {
  constructor(
    private readonly boss: BossService,
    private readonly sessions: SessionService,
    private readonly uploads: UploadsService,
  ) {}

  async onModuleInit() {
    await (await this.boss.boss()).work(QUEUE_MAINTENANCE, { batchSize: 1 }, async () => {
      await this.sessions.purgeExpired();
      await this.uploads.purgeOld();
    });
    await (await this.boss.boss()).schedule(QUEUE_MAINTENANCE, '17 3 * * *');
  }
}
