import { Injectable, Logger, OnApplicationShutdown, OnModuleInit } from '@nestjs/common';
import PgBoss from 'pg-boss';
import { appConfig } from '../config';

export const QUEUE_MAIL_SEND = 'mail-send';
export const QUEUE_MAIL_POLL = 'mail-poll';
export const QUEUE_MAINTENANCE = 'maintenance';
export const QUEUE_AUTOMATION = 'automation';

/** Hintergrundjobs über pg-boss (Job-Queue in PostgreSQL). */
@Injectable()
export class BossService implements OnModuleInit, OnApplicationShutdown {
  private readonly logger = new Logger(BossService.name);
  private readonly instance = new PgBoss({ connectionString: appConfig.databaseUrl, schema: 'pgboss', max: 5 });
  private startup: Promise<void> | null = null;
  private started = false;

  async onModuleInit() {
    await this.ready();
  }

  /**
   * Gestartete pg-boss-Instanz. Nest initialisiert Dienste parallel, deshalb warten
   * alle Verwender hier auf den Start.
   */
  async boss(): Promise<PgBoss> {
    await this.ready();
    return this.instance;
  }

  private ready(): Promise<void> {
    this.startup ??= this.start();
    return this.startup;
  }

  private async start() {
    this.instance.on('error', (err) => this.logger.error(`pg-boss: ${err.message}`));
    await this.instance.start();
    this.started = true;
    await this.ensureQueue(QUEUE_MAIL_SEND, {
      retryLimit: 10,
      retryDelay: 30,
      retryBackoff: true,
      expireInSeconds: 120,
    });
    // stately: höchstens ein wartender und ein laufender Abruf
    await this.ensureQueue(QUEUE_MAIL_POLL, { policy: 'stately', retryLimit: 0, expireInSeconds: 600 });
    await this.ensureQueue(QUEUE_MAINTENANCE, { policy: 'stately', retryLimit: 0 });
    await this.ensureQueue(QUEUE_AUTOMATION, { policy: 'stately', retryLimit: 0 });
  }

  async onApplicationShutdown() {
    if (this.started) await this.instance.stop({ graceful: true, timeout: 10000 });
  }

  private async ensureQueue(name: string, options: Omit<PgBoss.Queue, 'name'>) {
    const existing = await this.instance.getQueue(name);
    if (existing) await this.instance.updateQueue(name, { name, ...options });
    else await this.instance.createQueue(name, { name, ...options });
  }
}
