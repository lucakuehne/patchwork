import { Controller, Get, ServiceUnavailableException } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import { Public } from '../auth/auth.decorators';
import { InjectDb, type Db } from '../db/db.module';

/**
 * Healthcheck des Containers (deploy/portainer.yml): Anwendung antwortet und die Datenbank ist erreichbar. Ohne Anmeldung
 * und ohne Umleitung auf HTTPS (siehe main.ts), damit er im Container über http://127.0.0.1 läuft.
 */
@Controller()
export class HealthController {
  constructor(@InjectDb() private readonly db: Db) {}

  @Public()
  @Get('health')
  async health() {
    try {
      await this.db.execute(sql`select 1`);
    } catch {
      throw new ServiceUnavailableException('Datenbank nicht erreichbar');
    }
    return { status: 'ok' };
  }
}
