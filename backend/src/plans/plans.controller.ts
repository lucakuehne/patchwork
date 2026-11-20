import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
  Put,
  Query,
  Res,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import type { Response } from 'express';
import { z } from 'zod';
import { Audit } from '../audit/audit.decorators';
import { RequirePermission } from '../auth/auth.decorators';
import { ZodPipe } from '../common/zod.pipe';
import type { UploadedFile as UploadedFileData } from '../items/items.service';
import { StorageService } from '../storage/storage.service';
import { floorContentSchema, nodeNameSchema, PLAN_IMAGE_MAX_BYTES, PLAN_IMAGE_TYPES } from './plan-content';
import { PlansService } from './plans.service';

const searchSchema = z.object({ q: z.string().trim().min(1, 'Suchtext fehlt').max(100) });
const orderSchema = z.object({ ids: z.array(z.uuid()).max(500) });
type Name = z.infer<typeof nodeNameSchema>;

/**
 * Pläne (Entscheid vom 20.11.2026): Ansehen mit dem Recht «Pläne ansehen», ändern mit «Pläne bearbeiten». Standorte,
 * Gebäude und Stockwerke ändern sich sofort, den Inhalt eines Stockwerks speichert das Bearbeiten auf einmal.
 */
@Controller('plans')
export class PlansController {
  constructor(
    private readonly plans: PlansService,
    private readonly storage: StorageService,
  ) {}

  @RequirePermission('plansView')
  @Get()
  tree() {
    return this.plans.tree();
  }

  @RequirePermission('plansView')
  @Get('search')
  search(@Query(new ZodPipe(searchSchema)) query: z.infer<typeof searchSchema>) {
    return this.plans.search(query.q);
  }

  @RequirePermission('plansView')
  @Get('floors/:id')
  floor(@Param('id', ParseUUIDPipe) id: string) {
    return this.plans.floor(id);
  }

  /** Bild des Plans; die Adresse trägt einen Teil des Schlüssels, darum darf der Browser es behalten */
  @RequirePermission('plansView')
  @Get('floors/:id/image')
  async image(@Param('id', ParseUUIDPipe) id: string, @Res() res: Response) {
    const { storageKey, contentType } = await this.plans.planImage(id);
    res.setHeader('Content-Type', contentType);
    res.setHeader('Cache-Control', 'private, max-age=86400');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    this.storage
      .stream(storageKey)
      .on('error', () => res.status(404).end())
      .pipe(res);
  }

  /* ---------- Baum (nur Admins) ---------- */

  @RequirePermission('plansEdit')
  @Audit('plans', 'Standort angelegt', { fromResult: true })
  @Post('sites')
  createSite(@Body(new ZodPipe(nodeNameSchema)) body: Name) {
    return this.plans.createSite(body.name);
  }

  @RequirePermission('plansEdit')
  @Audit('plans', (c) => `Standort umbenannt in «${String(c.body.name).trim()}»`, { target: 'planSite' })
  @Put('sites/:id')
  renameSite(@Param('id', ParseUUIDPipe) id: string, @Body(new ZodPipe(nodeNameSchema)) body: Name) {
    return this.plans.renameSite(id, body.name);
  }

  @RequirePermission('plansEdit')
  @Audit('plans', 'Standort gelöscht', { target: 'planSite' })
  @Delete('sites/:id')
  @HttpCode(204)
  async removeSite(@Param('id', ParseUUIDPipe) id: string) {
    await this.plans.remove('site', id);
  }

  @RequirePermission('plansEdit')
  @Audit('plans', (c) => `Gebäude «${String(c.body.name).trim()}» angelegt`, { target: 'planSite' })
  @Post('sites/:id/buildings')
  createBuilding(@Param('id', ParseUUIDPipe) siteId: string, @Body(new ZodPipe(nodeNameSchema)) body: Name) {
    return this.plans.createBuilding(siteId, body.name);
  }

  @RequirePermission('plansEdit')
  @Audit('plans', (c) => `Gebäude umbenannt in «${String(c.body.name).trim()}»`, { target: 'planBuilding' })
  @Put('buildings/:id')
  renameBuilding(@Param('id', ParseUUIDPipe) id: string, @Body(new ZodPipe(nodeNameSchema)) body: Name) {
    return this.plans.renameBuilding(id, body.name);
  }

  @RequirePermission('plansEdit')
  @Audit('plans', 'Gebäude gelöscht', { target: 'planBuilding' })
  @Delete('buildings/:id')
  @HttpCode(204)
  async removeBuilding(@Param('id', ParseUUIDPipe) id: string) {
    await this.plans.remove('building', id);
  }

  @RequirePermission('plansEdit')
  @Audit('plans', (c) => `Stockwerk «${String(c.body.name).trim()}» angelegt`, { target: 'planBuilding' })
  @Post('buildings/:id/floors')
  createFloor(@Param('id', ParseUUIDPipe) buildingId: string, @Body(new ZodPipe(nodeNameSchema)) body: Name) {
    return this.plans.createFloor(buildingId, body.name);
  }

  @RequirePermission('plansEdit')
  @Audit('plans', 'Reihenfolge der Stockwerke geändert', { target: 'planBuilding' })
  @Put('buildings/:id/floor-order')
  @HttpCode(204)
  async orderFloors(@Param('id', ParseUUIDPipe) buildingId: string, @Body(new ZodPipe(orderSchema)) body: z.infer<typeof orderSchema>) {
    await this.plans.orderFloors(buildingId, body.ids);
  }

  @RequirePermission('plansEdit')
  @Audit('plans', (c) => `Stockwerk umbenannt in «${String(c.body.name).trim()}»`, { target: 'planFloor' })
  @Put('floors/:id')
  renameFloor(@Param('id', ParseUUIDPipe) id: string, @Body(new ZodPipe(nodeNameSchema)) body: Name) {
    return this.plans.renameFloor(id, body.name);
  }

  @RequirePermission('plansEdit')
  @Audit('plans', 'Stockwerk gelöscht', { target: 'planFloor' })
  @Delete('floors/:id')
  @HttpCode(204)
  async removeFloor(@Param('id', ParseUUIDPipe) id: string) {
    await this.plans.remove('floor', id);
  }

  /**
   * Inhalt eines Stockwerks speichern (multipart): «content» als JSON, dazu «plan» als Bild, wenn ein neuer Plan
   * hochgeladen wurde (eine PDF-Seite wandelt der Browser vorher in ein Bild um).
   */
  @RequirePermission('plansEdit')
  @Audit('plans', 'Stockwerk gespeichert', { target: 'planFloor' })
  @Put('floors/:id/content')
  @UseInterceptors(FileInterceptor('plan', { limits: { fileSize: PLAN_IMAGE_MAX_BYTES } }))
  async saveContent(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: { content?: string },
    @UploadedFile() file: UploadedFileData | undefined,
  ) {
    let raw: unknown;
    try {
      raw = JSON.parse(body.content ?? '');
    } catch {
      throw new BadRequestException('Inhalt fehlt oder ist kein JSON');
    }
    const content = new ZodPipe(floorContentSchema).transform(raw);
    if (file && !PLAN_IMAGE_TYPES.includes(file.mimetype)) throw new BadRequestException('Als Plan gehen PNG, JPEG und WebP');
    return this.plans.saveContent(id, content, file ? { buffer: file.buffer, contentType: file.mimetype } : null);
  }
}
