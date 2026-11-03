import { Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post, Put } from '@nestjs/common';
import { z } from 'zod';
import { checklistItemAction } from '../audit/audit-text';
import { Audit } from '../audit/audit.decorators';
import { AdminOnly, CurrentUser } from '../auth/auth.decorators';
import { ZodPipe } from '../common/zod.pipe';
import type { User } from '../db/schema';
import { AreasService } from '../settings/areas';
import { ChecklistsService } from './checklists.service';
import { ItemRefPipe } from './item-ref.pipe';
import type { ItemKey } from './item-ref';

const titleSchema = z.object({ title: z.string().trim().min(1, 'Titel fehlt').max(200) });
const textSchema = z.object({ text: z.string().trim().min(1, 'Text fehlt').max(1000) });
const orderSchema = z.object({ ids: z.array(z.uuid()).max(500) });
const itemUpdateSchema = z.object({
  text: z.string().trim().min(1, 'Text fehlt').max(1000).optional(),
  done: z.boolean().optional(),
});
const templateSchema = z.object({
  name: z.string().trim().min(1, 'Name fehlt').max(200),
  items: z.array(z.string().max(1000)).max(200),
});
const fromTemplateSchema = z.object({ templateId: z.uuid() });

/**
 * Checklisten gibt es nur bei Aufgaben: Routen über die Kennung prüft der AuthGuard, die über die ID der Checkliste
 * bzw. des Punkts verlangen den Bereich «Aufgaben» (Bereiche je Rolle).
 */
@Controller()
export class ChecklistsController {
  constructor(
    private readonly checklists: ChecklistsService,
    private readonly areas: AreasService,
  ) {}

  @Audit('items', 'Checkliste hinzugefügt')
  @Post('items/:ref/checklists')
  @HttpCode(204)
  async create(@Param('ref', ItemRefPipe) key: ItemKey, @Body(new ZodPipe(titleSchema)) body: { title: string }) {
    await this.checklists.create(key, body.title);
  }

  @Audit('items', 'Checkliste aus Vorlage hinzugefügt')
  @Post('items/:ref/checklists/from-template')
  @HttpCode(204)
  async fromTemplate(
    @Param('ref', ItemRefPipe) key: ItemKey,
    @Body(new ZodPipe(fromTemplateSchema)) body: { templateId: string },
  ) {
    await this.checklists.insertTemplate(key, body.templateId);
  }

  @Audit('items', 'Checklisten umsortiert')
  @Put('items/:ref/checklists/order')
  @HttpCode(204)
  async reorder(@Param('ref', ItemRefPipe) key: ItemKey, @Body(new ZodPipe(orderSchema)) body: { ids: string[] }) {
    await this.checklists.reorder(key, body.ids);
  }

  @Audit('items', 'Checkliste umbenannt', { target: 'checklist' })
  @Patch('checklists/:id')
  @HttpCode(204)
  async rename(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodPipe(titleSchema)) body: { title: string },
    @CurrentUser() user: User,
  ) {
    await this.areas.assertType(user, 'task');
    await this.checklists.rename(id, body.title);
  }

  @Audit('items', 'Checkliste gelöscht', { target: 'checklist' })
  @Delete('checklists/:id')
  @HttpCode(204)
  async remove(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: User) {
    await this.areas.assertType(user, 'task');
    await this.checklists.remove(id);
  }

  @Audit('items', 'Checklisten-Punkt hinzugefügt', { target: 'checklist' })
  @Post('checklists/:id/items')
  @HttpCode(204)
  async addItem(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodPipe(textSchema)) body: { text: string },
    @CurrentUser() user: User,
  ) {
    await this.areas.assertType(user, 'task');
    await this.checklists.addItem(id, body.text);
  }

  @Audit('items', 'Checklisten-Punkte umsortiert', { target: 'checklist' })
  @Put('checklists/:id/items/order')
  @HttpCode(204)
  async reorderItems(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodPipe(orderSchema)) body: { ids: string[] },
    @CurrentUser() user: User,
  ) {
    await this.areas.assertType(user, 'task');
    await this.checklists.reorderItems(id, body.ids);
  }

  @Audit('items', (c) => checklistItemAction(c.body), { target: 'checklistItem' })
  @Patch('checklist-items/:id')
  @HttpCode(204)
  async updateItem(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodPipe(itemUpdateSchema)) body: z.infer<typeof itemUpdateSchema>,
    @CurrentUser() user: User,
  ) {
    await this.areas.assertType(user, 'task');
    await this.checklists.updateItem(user.id, id, body);
  }

  @Audit('items', 'Checklisten-Punkt gelöscht', { target: 'checklistItem' })
  @Delete('checklist-items/:id')
  @HttpCode(204)
  async removeItem(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: User) {
    await this.areas.assertType(user, 'task');
    await this.checklists.removeItem(id);
  }

  /** Vorlagen zum Einfügen (für IT und Admin). */
  @Get('checklist-templates')
  templates() {
    return this.checklists.templates();
  }

  @AdminOnly()
  @Audit('admin', 'Checklisten-Vorlage erstellt', { fromResult: true })
  @Post('admin/checklist-templates')
  @HttpCode(204)
  async createTemplate(@Body(new ZodPipe(templateSchema)) body: z.infer<typeof templateSchema>) {
    await this.checklists.saveTemplate(null, body.name, body.items);
  }

  @AdminOnly()
  @Audit('admin', 'Checklisten-Vorlage geändert', { target: 'checklistTemplate' })
  @Put('admin/checklist-templates/:id')
  @HttpCode(204)
  async updateTemplate(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodPipe(templateSchema)) body: z.infer<typeof templateSchema>,
  ) {
    await this.checklists.saveTemplate(id, body.name, body.items);
  }

  @AdminOnly()
  @Audit('admin', 'Checklisten-Vorlage gelöscht', { target: 'checklistTemplate' })
  @Delete('admin/checklist-templates/:id')
  @HttpCode(204)
  async deleteTemplate(@Param('id', ParseUUIDPipe) id: string) {
    await this.checklists.deleteTemplate(id);
  }
}
