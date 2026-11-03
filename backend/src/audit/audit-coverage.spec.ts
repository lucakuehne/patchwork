import 'reflect-metadata';
import { RequestMethod } from '@nestjs/common';
import { METHOD_METADATA, PATH_METADATA } from '@nestjs/common/constants';
import { describe, expect, it } from 'vitest';
import { AppModule } from '../app.module';
import { AUDIT } from './audit.decorators';

const WRITING = new Set([RequestMethod.POST, RequestMethod.PUT, RequestMethod.PATCH, RequestMethod.DELETE]);

describe('Aktionsprotokoll', () => {
  it('jede schreibende Route trägt @Audit oder @NoAudit', () => {
    const controllers = Reflect.getMetadata('controllers', AppModule) as (new (...args: never[]) => object)[];
    const missing: string[] = [];
    let writing = 0;
    for (const controller of controllers) {
      const proto = controller.prototype as Record<string, unknown>;
      for (const name of Object.getOwnPropertyNames(proto)) {
        const handler = proto[name];
        if (name === 'constructor' || typeof handler !== 'function') continue;
        const method = Reflect.getMetadata(METHOD_METADATA, handler) as RequestMethod | undefined;
        if (method === undefined || !WRITING.has(method)) continue;
        writing++;
        if (Reflect.getMetadata(AUDIT, handler) === undefined) {
          missing.push(`${controller.name}.${name} (${String(Reflect.getMetadata(PATH_METADATA, handler))})`);
        }
      }
    }
    expect(writing).toBeGreaterThan(90);
    expect(missing).toEqual([]);
  });
});
