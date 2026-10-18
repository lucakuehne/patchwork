import { Injectable, NotFoundException } from '@nestjs/common';
import { asc, eq } from 'drizzle-orm';
import { InjectDb, type Db } from '../db/db.module';
import { snippets, type Snippet } from '../db/schema';

/** Textbausteine für Antworten und Notizen; Platzhalter ersetzt die Oberfläche beim Einfügen. */
@Injectable()
export class SnippetsService {
  constructor(@InjectDb() private readonly db: Db) {}

  list(): Promise<Snippet[]> {
    return this.db.select().from(snippets).orderBy(asc(snippets.name));
  }

  async create(input: { name: string; body: string }): Promise<Snippet> {
    const [created] = await this.db.insert(snippets).values(input).returning();
    return created!;
  }

  async update(id: string, input: { name: string; body: string }): Promise<Snippet> {
    const [updated] = await this.db
      .update(snippets)
      .set({ ...input, updatedAt: new Date() })
      .where(eq(snippets.id, id))
      .returning();
    if (!updated) throw new NotFoundException('Textbaustein nicht gefunden');
    return updated;
  }

  async remove(id: string): Promise<void> {
    await this.db.delete(snippets).where(eq(snippets.id, id));
  }
}
