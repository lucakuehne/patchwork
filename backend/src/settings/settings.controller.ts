import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  NotFoundException,
  Post,
  Put,
  Res,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import type { Response } from 'express';
import { X509Certificate } from 'node:crypto';
import { z } from 'zod';
import { AdminOnly, Public } from '../auth/auth.decorators';
import { AuthService } from '../auth/auth.service';
import { LdapService } from '../auth/ldap.service';
import { encryptSecret } from '../common/crypto';
import { ZodPipe } from '../common/zod.pipe';
import type { UploadedFile as UploadedFileData } from '../items/items.service';
import { StorageService } from '../storage/storage.service';
import { SettingsService, type LdapSettings } from './settings.service';

const LOGO_TYPES = ['image/png', 'image/jpeg', 'image/webp', 'image/svg+xml', 'image/gif'];

const generalSchema = z.object({ appName: z.string().trim().min(1, 'Name fehlt').max(100) });

/** Prüft ein PEM-Zertifikat und liefert Angaben zur Anzeige. */
function certificateInfo(pem: string): { subject: string; issuer: string; validTo: string } {
  const cert = new X509Certificate(pem);
  const cn = (dn: string) => dn.match(/CN=([^\n,]+)/)?.[1] ?? dn.replace(/\n/g, ', ');
  return { subject: cn(cert.subject), issuer: cn(cert.issuer), validTo: new Date(cert.validTo).toISOString() };
}

const caCertificateSchema = z
  .string()
  .max(20000)
  .default('')
  .transform((s) => s.replace(/\r\n?/g, '\n').trim())
  .superRefine((pem, ctx) => {
    if (!pem) return;
    try {
      if (!pem.includes('-----BEGIN CERTIFICATE-----')) throw new Error();
      certificateInfo(pem);
    } catch {
      ctx.addIssue({ code: 'custom', message: 'Kein gültiges Zertifikat im PEM-Format (-----BEGIN CERTIFICATE-----)' });
    }
  });

const ldapSchema = z.object({
  enabled: z.boolean(),
  url: z.string().trim().max(500),
  startTls: z.boolean(),
  rejectUnauthorized: z.boolean(),
  caCertificate: caCertificateSchema,
  bindDn: z.string().trim().max(500),
  /** undefined = unverändert, '' = löschen */
  bindPassword: z.string().max(500).optional(),
  baseDn: z.string().trim().max(500),
  userFilter: z.string().trim().max(1000).refine((f) => f.includes('{{username}}'), {
    message: 'Der Filter muss {{username}} enthalten',
  }),
  nameAttribute: z.string().trim().min(1).max(100),
  mailAttribute: z.string().trim().min(1).max(100),
  adminGroupDn: z.string().trim().max(500),
  itGroupDn: z.string().trim().max(500),
  nestedGroups: z.boolean(),
});

const ldapTestSchema = z.object({
  username: z.string().trim().max(200).optional(),
  password: z.string().max(500).optional(),
});

type LdapInput = z.infer<typeof ldapSchema>;

@Controller()
export class SettingsController {
  constructor(
    private readonly settings: SettingsService,
    private readonly storage: StorageService,
    private readonly auth: AuthService,
    private readonly ldap: LdapService,
  ) {}

  /** Angaben für Login-Seite und Kopfzeile. */
  @Public()
  @Get('public/info')
  async info() {
    const [general, logo, setupRequired] = await Promise.all([
      this.settings.get('general'),
      this.settings.get('logo'),
      this.auth.isSetupRequired(),
    ]);
    return { appName: general.appName, hasLogo: !!logo, logoVersion: logo?.storageKey.slice(-8) ?? null, setupRequired };
  }

  @Public()
  @Get('public/logo')
  async logo(@Res() res: Response) {
    const logo = await this.settings.get('logo');
    if (!logo) throw new NotFoundException();
    res.setHeader('Content-Type', logo.contentType);
    res.setHeader('Cache-Control', 'public, max-age=300');
    res.setHeader('Content-Security-Policy', "default-src 'none'; style-src 'unsafe-inline'; img-src data:");
    res.setHeader('X-Content-Type-Options', 'nosniff');
    this.storage.stream(logo.storageKey).on('error', () => res.status(404).end()).pipe(res);
  }

  @AdminOnly()
  @Get('settings/general')
  general() {
    return this.settings.get('general');
  }

  @AdminOnly()
  @Put('settings/general')
  async updateGeneral(@Body(new ZodPipe(generalSchema)) body: z.infer<typeof generalSchema>) {
    await this.settings.set('general', body);
    return body;
  }

  @AdminOnly()
  @Post('settings/logo')
  @HttpCode(204)
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: 2 * 1024 * 1024 } }))
  async uploadLogo(@UploadedFile() file: UploadedFileData | undefined) {
    if (!file) throw new BadRequestException('Keine Datei erhalten');
    if (!LOGO_TYPES.includes(file.mimetype)) {
      throw new BadRequestException('Erlaubt sind PNG, JPEG, WebP, GIF und SVG');
    }
    const previous = await this.settings.get('logo');
    const storageKey = await this.storage.save(file.buffer, 'logo');
    await this.settings.set('logo', { storageKey, contentType: file.mimetype });
    if (previous) await this.storage.remove(previous.storageKey);
  }

  @AdminOnly()
  @Delete('settings/logo')
  @HttpCode(204)
  async deleteLogo() {
    const previous = await this.settings.get('logo');
    await this.settings.remove('logo');
    if (previous) await this.storage.remove(previous.storageKey);
  }

  @AdminOnly()
  @Get('settings/ldap')
  async ldapSettings() {
    const { bindPasswordEnc, ...rest } = await this.settings.get('ldap');
    let caInfo: { subject: string; issuer: string; validTo: string } | null = null;
    try {
      caInfo = rest.caCertificate ? certificateInfo(rest.caCertificate) : null;
    } catch {
      caInfo = null;
    }
    return { ...rest, hasBindPassword: !!bindPasswordEnc, caInfo };
  }

  @AdminOnly()
  @Put('settings/ldap')
  async updateLdap(@Body(new ZodPipe(ldapSchema)) body: LdapInput) {
    const merged = await this.mergeLdap(body);
    if (merged.enabled && (!merged.url || !merged.baseDn)) {
      throw new BadRequestException('Für LDAP braucht es mindestens URL und Basis-DN');
    }
    if (merged.startTls && merged.url.toLowerCase().startsWith('ldaps:')) {
      throw new BadRequestException('STARTTLS ist nur mit ldap:// möglich');
    }
    await this.settings.set('ldap', merged);
    return this.ldapSettings();
  }

  /** Testet die übergebenen (noch nicht gespeicherten) Einstellungen. */
  @AdminOnly()
  @Post('settings/ldap/test')
  @HttpCode(200)
  async testLdap(
    @Body(new ZodPipe(ldapSchema.extend(ldapTestSchema.shape))) body: LdapInput & z.infer<typeof ldapTestSchema>,
  ) {
    const { username, password, ...settings } = body;
    const cfg = await this.mergeLdap(settings);
    try {
      return { checks: await this.ldap.diagnose(cfg, username || undefined, password || undefined) };
    } catch (err) {
      return { checks: [{ key: 'error', label: 'Test', status: 'error', message: (err as Error).message }] };
    }
  }

  /**
   * Übernimmt die Eingaben. Das gespeicherte Passwort des Dienstkontos wird nur weiterverwendet,
   * wenn Server-URL und Bind-DN unverändert sind – sonst ginge es an einen anderen Server bzw. ein anderes Konto.
   */
  private async mergeLdap(body: LdapInput): Promise<LdapSettings> {
    const current = await this.settings.get('ldap');
    const { bindPassword, ...rest } = body;
    const same = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();
    const reusable = same(rest.url, current.url) && same(rest.bindDn, current.bindDn);
    let bindPasswordEnc: string | null;
    if (bindPassword === undefined) bindPasswordEnc = reusable ? current.bindPasswordEnc : null;
    else bindPasswordEnc = bindPassword ? encryptSecret(bindPassword) : null;
    return { ...rest, bindPasswordEnc };
  }
}
