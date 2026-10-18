import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { asc, eq, inArray, max } from 'drizzle-orm';
import { InjectDb, type Db, type Tx } from '../db/db.module';
import {
  checklistItems,
  checklists,
  checklistTemplateItems,
  checklistTemplates,
  items,
  users,
  type Item,
} from '../db/schema';

export interface ChecklistView {
  id: string;
  title: string;
  items: {
    id: string;
    text: string;
    done: boolean;
    doneAt: Date | null;
    doneBy: string | null;
  }[];
}

/** Checklisten von Aufgaben. Änderungen erzeugen keine Timeline-Einträge. */
@Injectable()
export class ChecklistsService {
  constructor(@InjectDb() private readonly db: Db) {}

  async forItem(itemId: string, tx: Tx = this.db): Promise<ChecklistView[]> {
    const lists = await tx
      .select()
      .from(checklists)
      .where(eq(checklists.itemId, itemId))
      .orderBy(asc(checklists.position), asc(checklists.createdAt));
    if (lists.length === 0) return [];
    const rows = await tx
      .select({ entry: checklistItems, doneBy: users.name })
      .from(checklistItems)
      .leftJoin(users, eq(users.id, checklistItems.doneById))
      .where(
        inArray(
          checklistItems.checklistId,
          lists.map((l) => l.id),
        ),
      )
      .orderBy(asc(checklistItems.position), asc(checklistItems.createdAt));
    return lists.map((l) => ({
      id: l.id,
      title: l.title,
      items: rows
        .filter((r) => r.entry.checklistId === l.id)
        .map((r) => ({
          id: r.entry.id,
          text: r.entry.text,
          done: r.entry.done,
          doneAt: r.entry.doneAt,
          doneBy: r.doneBy,
        })),
    }));
  }

  async create(number: number, title: string): Promise<void> {
    await this.db.transaction(async (tx) => {
      const item = await this.taskByNumber(tx, number);
      const [row] = await tx
        .select({ max: max(checklists.position) })
        .from(checklists)
        .where(eq(checklists.itemId, item.id));
      await tx.insert(checklists).values({ itemId: item.id, title: title.trim(), position: (row?.max ?? -1) + 1 });
      await this.touch(tx, item.id);
    });
  }

  async rename(checklistId: string, title: string): Promise<void> {
    await this.db.transaction(async (tx) => {
      const list = await this.checklist(tx, checklistId);
      await tx.update(checklists).set({ title: title.trim() }).where(eq(checklists.id, list.id));
      await this.touch(tx, list.itemId);
    });
  }

  async remove(checklistId: string): Promise<void> {
    await this.db.transaction(async (tx) => {
      const list = await this.checklist(tx, checklistId);
      await tx.delete(checklists).where(eq(checklists.id, list.id));
      await this.touch(tx, list.itemId);
    });
  }

  /** Reihenfolge der Checklisten eines Vorgangs. */
  async reorder(number: number, ids: string[]): Promise<void> {
    await this.db.transaction(async (tx) => {
      const item = await this.taskByNumber(tx, number);
      const existing = await tx.select({ id: checklists.id }).from(checklists).where(eq(checklists.itemId, item.id));
      this.assertSameSet(
        existing.map((e) => e.id),
        ids,
      );
      for (const [position, id] of ids.entries()) {
        await tx.update(checklists).set({ position }).where(eq(checklists.id, id));
      }
    });
  }

  async addItem(checklistId: string, text: string): Promise<void> {
    await this.db.transaction(async (tx) => {
      const list = await this.checklist(tx, checklistId);
      const [row] = await tx
        .select({ max: max(checklistItems.position) })
        .from(checklistItems)
        .where(eq(checklistItems.checklistId, list.id));
      await tx.insert(checklistItems).values({ checklistId: list.id, text: text.trim(), position: (row?.max ?? -1) + 1 });
      await this.touch(tx, list.itemId);
    });
  }

  async updateItem(actorId: string, entryId: string, changes: { text?: string; done?: boolean }): Promise<void> {
    await this.db.transaction(async (tx) => {
      const { entry, list } = await this.checklistItem(tx, entryId);
      const set: Partial<typeof checklistItems.$inferInsert> = {};
      if (changes.text !== undefined) set.text = changes.text.trim();
      if (changes.done !== undefined && changes.done !== entry.done) {
        set.done = changes.done;
        set.doneAt = changes.done ? new Date() : null;
        set.doneById = changes.done ? actorId : null;
      }
      if (Object.keys(set).length === 0) return;
      await tx.update(checklistItems).set(set).where(eq(checklistItems.id, entry.id));
      await this.touch(tx, list.itemId);
    });
  }

  async removeItem(entryId: string): Promise<void> {
    await this.db.transaction(async (tx) => {
      const { entry, list } = await this.checklistItem(tx, entryId);
      await tx.delete(checklistItems).where(eq(checklistItems.id, entry.id));
      await this.touch(tx, list.itemId);
    });
  }

  /** Reihenfolge der Punkte einer Checkliste. */
  async reorderItems(checklistId: string, ids: string[]): Promise<void> {
    await this.db.transaction(async (tx) => {
      const list = await this.checklist(tx, checklistId);
      const existing = await tx
        .select({ id: checklistItems.id })
        .from(checklistItems)
        .where(eq(checklistItems.checklistId, list.id));
      this.assertSameSet(
        existing.map((e) => e.id),
        ids,
      );
      for (const [position, id] of ids.entries()) {
        await tx.update(checklistItems).set({ position }).where(eq(checklistItems.id, id));
      }
    });
  }

  // ---------------------------------------------------------------- Vorlagen

  async templates() {
    const list = await this.db.select().from(checklistTemplates).orderBy(asc(checklistTemplates.name));
    if (list.length === 0) return [];
    const rows = await this.db
      .select()
      .from(checklistTemplateItems)
      .where(
        inArray(
          checklistTemplateItems.templateId,
          list.map((t) => t.id),
        ),
      )
      .orderBy(asc(checklistTemplateItems.position));
    return list.map((t) => ({
      id: t.id,
      name: t.name,
      items: rows.filter((r) => r.templateId === t.id).map((r) => r.text),
    }));
  }

  async saveTemplate(id: string | null, name: string, entries: string[]): Promise<void> {
    const texts = entries.map((e) => e.trim()).filter(Boolean);
    if (texts.length === 0) throw new BadRequestException('Eine Vorlage braucht mindestens einen Punkt');
    await this.db.transaction(async (tx) => {
      let templateId = id;
      if (templateId) {
        const updated = await tx
          .update(checklistTemplates)
          .set({ name: name.trim() })
          .where(eq(checklistTemplates.id, templateId))
          .returning();
        if (updated.length === 0) throw new NotFoundException('Vorlage nicht gefunden');
        await tx.delete(checklistTemplateItems).where(eq(checklistTemplateItems.templateId, templateId));
      } else {
        const [created] = await tx.insert(checklistTemplates).values({ name: name.trim() }).returning();
        templateId = created!.id;
      }
      await tx
        .insert(checklistTemplateItems)
        .values(texts.map((text, position) => ({ templateId: templateId!, text, position })));
    });
  }

  async deleteTemplate(id: string): Promise<void> {
    const deleted = await this.db.delete(checklistTemplates).where(eq(checklistTemplates.id, id)).returning();
    if (deleted.length === 0) throw new NotFoundException('Vorlage nicht gefunden');
  }

  /** Fügt eine Vorlage als neue Checkliste in eine Aufgabe ein. */
  async insertTemplate(number: number, templateId: string): Promise<void> {
    await this.db.transaction(async (tx) => {
      const item = await this.taskByNumber(tx, number);
      if (!(await this.addFromTemplate(tx, item.id, templateId))) throw new NotFoundException('Vorlage nicht gefunden');
      await this.touch(tx, item.id);
    });
  }

  /** Neue Checkliste aus einer Vorlage (auch für Regeln). Gibt den Namen der Vorlage zurück, null wenn es sie nicht gibt. */
  async addFromTemplate(tx: Tx, itemId: string, templateId: string): Promise<string | null> {
    const [template] = await tx.select().from(checklistTemplates).where(eq(checklistTemplates.id, templateId)).limit(1);
    if (!template) return null;
    const texts = await tx
      .select({ text: checklistTemplateItems.text })
      .from(checklistTemplateItems)
      .where(eq(checklistTemplateItems.templateId, template.id))
      .orderBy(asc(checklistTemplateItems.position));
    const [row] = await tx
      .select({ max: max(checklists.position) })
      .from(checklists)
      .where(eq(checklists.itemId, itemId));
    const [list] = await tx
      .insert(checklists)
      .values({ itemId, title: template.name, position: (row?.max ?? -1) + 1 })
      .returning();
    if (texts.length > 0) {
      await tx.insert(checklistItems).values(texts.map((t, position) => ({ checklistId: list!.id, text: t.text, position })));
    }
    return template.name;
  }

  private async taskByNumber(tx: Tx, number: number): Promise<Item> {
    const [item] = await tx.select().from(items).where(eq(items.number, number)).for('update').limit(1);
    if (!item) throw new NotFoundException('Vorgang nicht gefunden');
    if (item.type !== 'task') throw new BadRequestException('Checklisten gibt es nur bei Aufgaben');
    return item;
  }

  /** Checkliste inkl. Prüfung, dass der Vorgang (noch) eine Aufgabe ist. */
  private async checklist(tx: Tx, checklistId: string) {
    const [row] = await tx
      .select({ list: checklists, type: items.type })
      .from(checklists)
      .innerJoin(items, eq(items.id, checklists.itemId))
      .where(eq(checklists.id, checklistId))
      .limit(1);
    if (!row) throw new NotFoundException('Checkliste nicht gefunden');
    if (row.type !== 'task') throw new BadRequestException('Checklisten gibt es nur bei Aufgaben');
    return row.list;
  }

  private async checklistItem(tx: Tx, entryId: string) {
    const [row] = await tx.select().from(checklistItems).where(eq(checklistItems.id, entryId)).limit(1);
    if (!row) throw new NotFoundException('Punkt nicht gefunden');
    return { entry: row, list: await this.checklist(tx, row.checklistId) };
  }

  private async touch(tx: Tx, itemId: string) {
    await tx.update(items).set({ updatedAt: new Date() }).where(eq(items.id, itemId));
  }

  private assertSameSet(existing: string[], ids: string[]) {
    const known = new Set(existing);
    if (ids.length !== existing.length || new Set(ids).size !== ids.length || !ids.every((id) => known.has(id))) {
      throw new BadRequestException('Die Reihenfolge muss alle Einträge genau einmal enthalten');
    }
  }
}
