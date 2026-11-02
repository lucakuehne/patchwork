import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { and, desc, eq, inArray, isNotNull, max } from 'drizzle-orm';
import { swissDate } from '../common/swiss-date';
import { appConfig } from '../config';
import { InjectDb, type Db, type Tx } from '../db/db.module';
import { items, recurringTasks, statuses, users, type Item, type RecurringChecklist, type RecurringTask, type User } from '../db/schema';
import { ChecklistsService } from '../items/checklists.service';
import { itemRef, type ItemKey } from '../items/item-ref';
import { ItemsService } from '../items/items.service';
import { newItemStatus } from '../items/status-change';
import { MailboxesService } from '../mail/mailboxes.service';
import { NotificationsService } from '../mail/notifications.service';
import { StatusesService } from '../statuses/statuses.service';
import { ChannelsService } from '../channels/channels.service';
import {
  dueNow,
  firstOpen,
  following,
  localTime,
  taskTitle,
  upcoming,
  type Occurrence,
  type Recurrence,
  type Schedule,
  type WeekendRule,
} from './recurrence';

export interface RecurringTaskInput {
  title: string;
  description: string;
  priority: Item['priority'];
  statusId: string | null;
  assigneeId: string | null;
  channelId: string | null;
  checklists: RecurringChecklist[];
  schedule: Recurrence;
  startDate: string;
  endDate: string | null;
  weekend: WeekendRule;
  leadDays: number;
  active: boolean;
}

/** So viele zuletzt angelegte Aufgaben zeigt eine wiederkehrende Aufgabe */
const RECENT = 5;

/**
 * Wiederkehrende Aufgaben (seit 02.11.2026): Vorlagen, aus denen Patchwork nach ihrem Rhythmus Aufgaben anlegt, geprüft
 * alle 15 Minuten mit den zeitgesteuerten Regeln. Die Aufgabe entsteht am Tag ihrer Fälligkeit (bzw. so viele Tage
 * vorher wie der Vorlauf) ab 06:00 Uhr; ist die vorherige noch offen, entsteht sie trotzdem.
 */
@Injectable()
export class RecurringTasksService {
  private readonly logger = new Logger(RecurringTasksService.name);

  constructor(
    @InjectDb() private readonly db: Db,
    private readonly items: ItemsService,
    private readonly checklists: ChecklistsService,
    private readonly statuses: StatusesService,
    private readonly channels: ChannelsService,
    private readonly mailboxes: MailboxesService,
    private readonly notifications: NotificationsService,
  ) {}

  private today(now = new Date()): string {
    return localTime(now, appConfig.timeZone).date;
  }

  async list() {
    const rows = await this.db
      .select({ task: recurringTasks, creatorName: users.name })
      .from(recurringTasks)
      .innerJoin(users, eq(users.id, recurringTasks.creatorId))
      .orderBy(recurringTasks.title);
    if (rows.length === 0) return [];
    // Zuletzt angelegte Aufgaben je Vorlage, neueste zuerst
    const created = await this.db
      .select({
        recurringTaskId: items.recurringTaskId,
        prefix: items.prefix,
        number: items.number,
        title: items.title,
        dueDate: items.dueDate,
        recurringDue: items.recurringDue,
        status: { id: statuses.id, label: statuses.label, closed: statuses.closed, color: statuses.color },
      })
      .from(items)
      .leftJoin(statuses, eq(statuses.id, items.statusId))
      .where(inArray(items.recurringTaskId, rows.map((r) => r.task.id)))
      .orderBy(desc(items.recurringDue), desc(items.number));
    return rows.map(({ task, creatorName }) => ({
      ...this.view(task),
      creator: { id: task.creatorId, name: creatorName },
      recent: created
        .filter((c) => c.recurringTaskId === task.id)
        .slice(0, RECENT)
        .map(({ recurringTaskId: _id, recurringDue: _due, ...rest }) => rest),
    }));
  }

  private view(task: RecurringTask) {
    const [next] = upcoming(task, task.nextOn, 1);
    return {
      id: task.id,
      title: task.title,
      description: task.description,
      priority: task.priority,
      statusId: task.statusId,
      assigneeId: task.assigneeId,
      channelId: task.channelId,
      checklists: task.checklists,
      schedule: task.schedule,
      startDate: task.startDate,
      endDate: task.endDate,
      weekend: task.weekend,
      leadDays: task.leadDays,
      active: task.active,
      /** Nächster Termin, dessen Aufgabe noch fehlt (auch wenn pausiert); null = keiner mehr */
      next: next ? { ...next, title: taskTitle(task.title, next.on) } : null,
      createdAt: task.createdAt,
      updatedAt: task.updatedAt,
    };
  }

  /** Die nächsten Termine mit Titel, für die Vorschau beim Bearbeiten (ohne bereits angelegte, falls «id») */
  async preview(input: Pick<RecurringTaskInput, 'title' | keyof Schedule>, id: string | null, count = 5) {
    const nextOn = firstOpen(input, this.today(), id ? await this.lastDue(this.db, id) : null);
    return upcoming(input, nextOn, count).map((o) => ({ ...o, title: taskTitle(input.title, o.on) }));
  }

  async create(actor: User, input: RecurringTaskInput) {
    await this.validate(input);
    const [task] = await this.db
      .insert(recurringTasks)
      .values({ ...input, creatorId: actor.id, nextOn: firstOpen(input, this.today(), null) })
      .returning();
    return this.view(task!);
  }

  /** Ändern; der nächste Termin richtet sich danach neu aus (ab heute, nach der letzten angelegten Aufgabe) */
  async update(id: string, input: RecurringTaskInput) {
    await this.validate(input);
    return this.db.transaction(async (tx) => {
      await this.lock(tx, id);
      const nextOn = firstOpen(input, this.today(), await this.lastDue(tx, id));
      const [task] = await tx
        .update(recurringTasks)
        .set({ ...input, nextOn, updatedAt: new Date() })
        .where(eq(recurringTasks.id, id))
        .returning();
      return this.view(task!);
    });
  }

  /** Löschen: die angelegten Aufgaben bleiben, ohne Verweis auf die Vorlage */
  async remove(id: string): Promise<void> {
    const deleted = await this.db.delete(recurringTasks).where(eq(recurringTasks.id, id)).returning({ id: recurringTasks.id });
    if (deleted.length === 0) throw new NotFoundException('Wiederkehrende Aufgabe nicht gefunden');
  }

  /**
   * «Jetzt anlegen»: die Aufgabe des nächsten Termins sofort, auch bei einer pausierten Vorlage. Der Plan geht danach mit
   * dem Termin darauf weiter.
   */
  async createNow(actor: User, id: string): Promise<ItemKey> {
    let created: Item | null = null;
    await this.db.transaction(async (tx) => {
      const task = await this.lock(tx, id);
      let on = task.nextOn;
      // Fallen mehrere Termine auf dieselbe Fälligkeit (Wochenende auf Montag), gilt der erste ohne Aufgabe
      for (let i = 0; on && !created && i < 10; i++) {
        const [o] = upcoming(task, on, 1);
        created = await this.createTask(tx, task, o!, actor);
        on = following(task, on);
      }
      if (!created) throw new BadRequestException('Es gibt keinen weiteren Termin (Enddatum erreicht)');
      await tx.update(recurringTasks).set({ nextOn: on }).where(eq(recurringTasks.id, id));
    });
    const item = created as Item | null;
    if (!item) throw new BadRequestException('Es gibt keinen weiteren Termin');
    await this.notify(item, actor);
    return { prefix: item.prefix, number: item.number };
  }

  /** Durchlauf (alle 15 Minuten): fällige Aufgaben aller aktiven Vorlagen anlegen */
  async run(now = new Date()): Promise<{ created: number }> {
    const local = localTime(now, appConfig.timeZone);
    const active = await this.db
      .select({ id: recurringTasks.id })
      .from(recurringTasks)
      .where(and(eq(recurringTasks.active, true), isNotNull(recurringTasks.nextOn)));
    let created = 0;
    for (const { id } of active) {
      const made: Item[] = [];
      try {
        await this.db.transaction(async (tx) => {
          const [task] = await tx.select().from(recurringTasks).where(eq(recurringTasks.id, id)).for('update', { skipLocked: true }).limit(1);
          if (!task?.active || !task.nextOn) return;
          const plan = dueNow(task, task.nextOn, local);
          for (const o of plan.create) {
            const item = await this.createTask(tx, task, o, null);
            if (item) made.push(item);
          }
          if (plan.nextOn !== task.nextOn) await tx.update(recurringTasks).set({ nextOn: plan.nextOn }).where(eq(recurringTasks.id, id));
        });
      } catch (err) {
        this.logger.error(`Wiederkehrende Aufgabe ${id}: Anlegen fehlgeschlagen: ${(err as Error).message}`);
        continue;
      }
      created += made.length;
      for (const item of made) await this.notify(item, null);
    }
    return { created };
  }

  /**
   * Aufgabe zu einem Termin anlegen; null, wenn es zu dieser Fälligkeit schon eine gibt. Status der Vorlage, sofern es
   * ihn als offenen Status der Aufgaben noch gibt, sonst der Start-Status. Ein inzwischen inaktiver Zuständiger entfällt.
   */
  private async createTask(tx: Tx, task: RecurringTask, o: Occurrence, actor: User | null): Promise<Item | null> {
    const [existing] = await tx
      .select({ id: items.id })
      .from(items)
      .where(and(eq(items.recurringTaskId, task.id), eq(items.recurringDue, o.due)))
      .limit(1);
    if (existing) return null;
    const [all, targets] = await Promise.all([this.statuses.list(tx), this.statuses.targets(tx)]);
    const chosen = all.find((s) => s.id === task.statusId && s.type === 'task' && !s.closed && s.id !== targets.task.reject);
    const status = chosen ?? newItemStatus(all, targets.task, 'task', null);
    const assignee = task.assigneeId ? await this.staff(tx, task.assigneeId) : null;
    const mailbox = await this.mailboxes.getDefault(tx);
    const [item] = await tx
      .insert(items)
      .values({
        type: 'task',
        statusId: status.id,
        title: taskTitle(task.title, o.on),
        description: task.description,
        priority: task.priority,
        creatorId: actor?.id ?? task.creatorId,
        reporterId: task.creatorId,
        assigneeId: assignee?.id ?? null,
        mailboxId: mailbox?.id ?? null,
        source: 'internal',
        channelId: task.channelId,
        dueDate: o.due,
        boardPosition: await this.items.endOfColumn(tx, status.id),
        recurringTaskId: task.id,
        recurringDue: o.due,
      })
      .returning();
    for (const list of task.checklists) await this.checklists.addList(tx, item!.id, list.title, list.items);
    await this.items.addEntry(tx, item!.id, actor?.id ?? null, 'change', '', {
      field: 'recurring',
      recurringId: task.id,
      recurringTitle: task.title,
      dueDate: swissDate(o.due),
    });
    return item!;
  }

  /** Mail «Zugewiesen» an den Zuständigen; Melder ist der Ersteller der Vorlage, er erhält keine Eingangsbestätigung */
  private async notify(item: Item, actor: User | null) {
    if (!item.assigneeId) return;
    await this.notifications
      .assigned(item, actor?.id ?? null, actor ? undefined : 'Wiederkehrende Aufgabe')
      .catch((err: Error) => this.logger.error(`Mail «Zugewiesen» für ${itemRef(item)} fehlgeschlagen: ${err.message}`));
  }

  private async lock(tx: Tx, id: string): Promise<RecurringTask> {
    const [task] = await tx.select().from(recurringTasks).where(eq(recurringTasks.id, id)).for('update').limit(1);
    if (!task) throw new NotFoundException('Wiederkehrende Aufgabe nicht gefunden');
    return task;
  }

  /** Letzte angelegte Fälligkeit einer Vorlage */
  private async lastDue(tx: Tx, id: string): Promise<string | null> {
    const [row] = await tx
      .select({ last: max(items.recurringDue) })
      .from(items)
      .where(eq(items.recurringTaskId, id));
    return row?.last ?? null;
  }

  private async staff(tx: Tx, userId: string): Promise<User | null> {
    const [user] = await tx.select().from(users).where(eq(users.id, userId)).limit(1);
    return user?.active && user.role !== 'standard' ? user : null;
  }

  private async validate(input: RecurringTaskInput) {
    if (input.statusId) {
      const [all, targets] = await Promise.all([this.statuses.list(), this.statuses.targets()]);
      const status = all.find((s) => s.id === input.statusId);
      if (!status || status.type !== 'task') throw new BadRequestException('Der Status passt nicht zu Aufgaben');
      if (status.closed || status.id === targets.task.reject) {
        throw new BadRequestException('Neue Aufgaben können nicht in einem abgeschlossenen Status beginnen');
      }
    }
    if (input.assigneeId && !(await this.staff(this.db, input.assigneeId))) {
      throw new BadRequestException('Zuständig kann nur ein aktiver IT-Mitarbeitender sein');
    }
    if (input.channelId) {
      const channel = await this.channels.get(input.channelId);
      if (channel.key === 'portal') throw new BadRequestException('«Portal» setzt Patchwork selbst');
    }
  }
}
