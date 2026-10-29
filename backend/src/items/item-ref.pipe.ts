import { BadRequestException, Injectable, type PipeTransform } from '@nestjs/common';
import { parseItemRef, type ItemKey } from './item-ref';

/** Kennung eines Vorgangs aus der Route («PW-123», «HS-17223» oder nur «123» für PW) */
@Injectable()
export class ItemRefPipe implements PipeTransform<string, ItemKey> {
  transform(value: string): ItemKey {
    const key = parseItemRef(value);
    if (!key) throw new BadRequestException(`Ungültige Kennung «${String(value).slice(0, 40)}», erwartet z.B. PW-123`);
    return key;
  }
}
