import { Body, Controller, Delete, HttpCode, Param, ParseUUIDPipe, Post } from '@nestjs/common';
import { z } from 'zod';
import { CurrentUser } from '../auth/auth.decorators';
import { ZodPipe } from '../common/zod.pipe';
import type { User } from '../db/schema';
import { AreasService } from '../settings/areas';
import { LINK_ROLES, LinksService } from './links.service';
import { itemRefSchema, type ItemKey } from './item-ref';
import { ItemRefPipe } from './item-ref.pipe';

const linkSchema = z.object({
  role: z.enum(LINK_ROLES),
  /** Kennung des anderen Vorgangs */
  other: itemRefSchema,
});

@Controller()
export class LinksController {
  constructor(
    private readonly links: LinksService,
    private readonly areas: AreasService,
  ) {}

  @Post('items/:ref/links')
  @HttpCode(204)
  async add(
    @Param('ref', ItemRefPipe) key: ItemKey,
    @Body(new ZodPipe(linkSchema)) body: z.infer<typeof linkSchema>,
    @CurrentUser() user: User,
  ) {
    // Der eigene Vorgang ist schon geprüft (AuthGuard), der andere muss ebenfalls in den Bereichen des Benutzers liegen
    await this.areas.assertKey(user, body.other);
    await this.links.add(user.id, key, body.role, body.other);
  }

  @Delete('items/:ref/links/:linkId')
  @HttpCode(204)
  async remove(
    @Param('ref', ItemRefPipe) key: ItemKey,
    @Param('linkId', ParseUUIDPipe) linkId: string,
    @CurrentUser() user: User,
  ) {
    await this.links.remove(user.id, key, linkId);
  }
}
