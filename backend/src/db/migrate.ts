import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { resolve } from 'node:path';
import { Pool } from 'pg';
import { appConfig } from '../config';
import * as schema from './schema';
import { DEFAULT_STATUSES } from '../statuses/status-rules';

/** Führt ausstehende Migrationen aus und legt beim ersten Start die Standardstatus an. */
export async function migrateDatabase(): Promise<void> {
  const pool = new Pool({ connectionString: appConfig.databaseUrl, max: 1 });
  try {
    const db = drizzle(pool, { schema });
    await migrate(db, { migrationsFolder: resolve(__dirname, '../../drizzle') });

    const existing = await db.select({ id: schema.statuses.id }).from(schema.statuses).limit(1);
    if (existing.length === 0) {
      await db.insert(schema.statuses).values(DEFAULT_STATUSES);
    }
  } finally {
    await pool.end();
  }
}
