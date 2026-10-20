import { Global, Inject, Logger, Module, OnApplicationShutdown } from '@nestjs/common';
import { drizzle, NodePgDatabase } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import { appConfig } from '../config';
import * as schema from './schema';

export type Db = NodePgDatabase<typeof schema>;
/** Datenbank oder laufende Transaktion */
export type Tx = Db | Parameters<Parameters<Db['transaction']>[0]>[0];

export const DB = Symbol('DB');
export const PG_POOL = Symbol('PG_POOL');
export const InjectDb = () => Inject(DB);

@Global()
@Module({
  providers: [
    {
      provide: PG_POOL,
      useFactory: () => {
        const pool = new Pool({ connectionString: appConfig.databaseUrl, max: 10 });
        // Bricht eine ruhende Verbindung ab (z.B. Neustart der Datenbank), verwirft der Pool sie und öffnet bei Bedarf
        // eine neue. Ohne diesen Handler würde der Fehler Patchwork beenden.
        pool.on('error', (err) => new Logger('Datenbank').warn(`Verbindung abgebrochen: ${err.message}`));
        return pool;
      },
    },
    {
      provide: DB,
      inject: [PG_POOL],
      useFactory: (pool: Pool): Db => drizzle(pool, { schema }),
    },
  ],
  exports: [DB, PG_POOL],
})
export class DbModule implements OnApplicationShutdown {
  constructor(@Inject(PG_POOL) private readonly pool: Pool) {}

  async onApplicationShutdown() {
    await this.pool.end();
  }
}
