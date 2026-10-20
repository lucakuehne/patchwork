import 'reflect-metadata';
import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import cookieParser from 'cookie-parser';
import type { NextFunction, Request, Response } from 'express';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import type { TLSSocket } from 'node:tls';
import { appConfig } from './config';
import { migrateDatabase } from './db/migrate';
import { AppModule } from './app.module';
import { TlsService } from './tls/tls.service';

async function bootstrap() {
  const logger = new Logger('Patchwork');
  await migrateDatabase();

  const app = await NestFactory.create<NestExpressApplication>(AppModule, { bufferLogs: false });
  app.set('trust proxy', 'loopback, linklocal, uniquelocal');
  app.disable('x-powered-by');

  // Läuft HTTPS und steht PUBLIC_URL auf https://, gehen Anfragen über http:// auf die öffentliche Adresse.
  // Massgebend ist die Verbindung selbst, nicht X-Forwarded-Proto.
  const tls = app.get(TlsService);
  app.use((req: Request, res: Response, next: NextFunction) => {
    if (!tls.redirects || (req.socket as TLSSocket).encrypted) return next();
    res.redirect(307, appConfig.publicUrl + req.originalUrl);
  });

  app.use(cookieParser());
  app.setGlobalPrefix('api');
  app.enableShutdownHooks();

  // Frontend als statische Dateien. Single-Page-App: übrige Seitenpfade liefern index.html
  const indexHtml = join(appConfig.frontendDir, 'index.html');
  if (existsSync(indexHtml)) {
    app.useStaticAssets(appConfig.frontendDir, { index: false, maxAge: '1y', immutable: true });
    app.use((req: Request, res: Response, next: NextFunction) => {
      if (req.method !== 'GET' || req.path === '/api' || req.path.startsWith('/api/')) return next();
      if (/\.[a-z0-9]+$/i.test(req.path)) return next();
      res.setHeader('Cache-Control', 'no-cache');
      res.sendFile(indexHtml);
    });
  } else {
    logger.warn(`Kein Frontend unter ${appConfig.frontendDir} gefunden, nur die API ist verfügbar`);
  }

  await app.listen(appConfig.port);
  logger.log(`Patchwork läuft auf Port ${appConfig.port} (${appConfig.publicUrl})`);
  // HTTPS mit dem Zertifikat aus Verwaltung → HTTPS, falls eingerichtet
  await tls.start();
}

void bootstrap();
