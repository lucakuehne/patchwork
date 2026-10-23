import { Body, Controller, Delete, Get, HttpCode, Param, ParseIntPipe, ParseUUIDPipe, Patch, Post, Put } from '@nestjs/common';
import { z } from 'zod';
import { AdminOnly, CurrentUser } from '../auth/auth.decorators';
import { ZodPipe } from '../common/zod.pipe';
import type { User } from '../db/schema';
import { AreasService } from '../settings/areas';
import { ChecklistsService } from './checklists.service';

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
 * Checklisten gibt es nur bei Aufgaben: Routen über die Nummer prüft der AuthGuard, die über die ID der Checkliste
 * bzw. des Punkts verlangen den Bereich «Aufgaben» (Bereiche je Rolle).
 */
@Controller()
export class ChecklistsController {
  constructor(
    private readonly checklists: ChecklistsService,
    private readonly areas: AreasService,
  ) {}

  @Post('items/:number/checklists')
  @HttpCode(204)
  async create(@Param('number', ParseIntPipe) number: number, @Body(new ZodPipe(titleSchema)) body: { title: string }) {
    await this.checklists.create(number, body.title);
  }

  @Post('items/:number/checklists/from-template')
  @HttpCode(204)
  async fromTemplate(
    @Param('number', ParseIntPipe) number: number,
    @Body(new ZodPipe(fromTemplateSchema)) body: { templateId: string },
  ) {
    await this.checklists.insertTemplate(number, body.templateId);
  }

  @Put('items/:number/checklists/order')
  @HttpCode(204)
  async reorder(@Param('number', ParseIntPipe) number: number, @Body(new ZodPipe(orderSchema)) body: { ids: string[] }) {
    await this.checklists.reorder(number, body.ids);
  }

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

  @Delete('checklists/:id')
  @HttpCode(204)
  async remove(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: User) {
    await this.areas.assertType(user, 'task');
    await this.checklists.remove(id);
  }

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
  @Post('admin/checklist-templates')
  @HttpCode(204)
  async createTemplate(@Body(new ZodPipe(templateSchema)) body: z.infer<typeof templateSchema>) {
    await this.checklists.saveTemplate(null, body.name, body.items);
  }

  @AdminOnly()
  @Put('admin/checklist-templates/:id')
  @HttpCode(204)
  async updateTemplate(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodPipe(templateSchema)) body: z.infer<typeof templateSchema>,
  ) {
    await this.checklists.saveTemplate(id, body.name, body.items);
  }

  @AdminOnly()
  @Delete('admin/checklist-templates/:id')
  @HttpCode(204)
  async deleteTemplate(@Param('id', ParseUUIDPipe) id: string) {
    await this.checklists.deleteTemplate(id);
  }
}
