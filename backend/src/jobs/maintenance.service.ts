import { Injectable, OnModuleInit } from '@nestjs/common';
import { SessionService } from '../auth/session.service';
import { BossService, QUEUE_MAINTENANCE } from './boss.service';

/** Nächtliche Aufräumarbeiten. */
@Injectable()
export class MaintenanceService implements OnModuleInit {
  constructor(
    private readonly boss: BossService,
    private readonly sessions: SessionService,
  ) {}

  async onModuleInit() {
    await (await this.boss.boss()).work(QUEUE_MAINTENANCE, { batchSize: 1 }, () => this.sessions.purgeExpired());
    await (await this.boss.boss()).schedule(QUEUE_MAINTENANCE, '17 3 * * *');
  }
}
