import { Body, Controller, Delete, HttpCode, Param, ParseIntPipe, ParseUUIDPipe, Post } from '@nestjs/common';
import { z } from 'zod';
import { CurrentUser } from '../auth/auth.decorators';
import { ZodPipe } from '../common/zod.pipe';
import type { User } from '../db/schema';
import { AreasService } from '../settings/areas';
import { LINK_ROLES, LinksService } from './links.service';

const linkSchema = z.object({
  role: z.enum(LINK_ROLES),
  otherNumber: z.coerce.number().int().positive(),
});

@Controller()
export class LinksController {
  constructor(
    private readonly links: LinksService,
    private readonly areas: AreasService,
  ) {}

  @Post('items/:number/links')
  @HttpCode(204)
  async add(
    @Param('number', ParseIntPipe) number: number,
    @Body(new ZodPipe(linkSchema)) body: z.infer<typeof linkSchema>,
    @CurrentUser() user: User,
  ) {
    // Der eigene Vorgang ist schon geprüft (AuthGuard), der andere muss ebenfalls in den Bereichen des Benutzers liegen
    await this.areas.assertNumber(user, body.otherNumber);
    await this.links.add(user.id, number, body.role, body.otherNumber);
  }

  @Delete('items/:number/links/:linkId')
  @HttpCode(204)
  async remove(
    @Param('number', ParseIntPipe) number: number,
    @Param('linkId', ParseUUIDPipe) linkId: string,
    @CurrentUser() user: User,
  ) {
    await this.links.remove(user.id, number, linkId);
  }
}
