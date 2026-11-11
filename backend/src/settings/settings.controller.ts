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
import { Audit, NoAudit } from '../audit/audit.decorators';
import { AdminOnly, CurrentUser, Public } from '../auth/auth.decorators';
import { AuthService } from '../auth/auth.service';
import { LdapService } from '../auth/ldap.service';
import { encryptSecret } from '../common/crypto';
import { emailSchema, ZodPipe } from '../common/zod.pipe';
import { appConfig } from '../config';
import type { UploadedFile as UploadedFileData } from '../items/items.service';
import { callbackUrl } from '../mail/microsoft';
import { isLive, triggerCircles } from '../mail/test-delivery';
import { PortalAccessService } from '../portal/portal-access.service';
import { StorageService } from '../storage/storage.service';
import { TlsService } from '../tls/tls.service';
import type { User } from '../db/schema';
import { AREAS, AreasService } from './areas';
import {
  BLOCK_TRIGGERS,
  BOARD_CLOSED_DAYS,
  DELIVERY_BLOCKS,
  SettingsService,
  type DeliveryBlock,
  type LdapSettings,
} from './settings.service';

const LOGO_TYPES = ['image/png', 'image/jpeg', 'image/webp', 'image/svg+xml', 'image/gif'];

const generalSchema = z.object({
  appName: z.string().trim().min(1, 'Name fehlt').max(100),
  // Ohne Angabe bleibt der gespeicherte Wert
  boardClosedDays: z
    .number()
    .int('Bitte eine ganze Zahl von Tagen angeben')
    .min(BOARD_CLOSED_DAYS.min, `Mindestens ${BOARD_CLOSED_DAYS.min} Tag`)
    .max(BOARD_CLOSED_DAYS.max, `Höchstens ${BOARD_CLOSED_DAYS.max} Tage`)
    .optional(),
});
const scope = z.enum(['none', 'selected', 'all']);
const addressList = z
  .array(emailSchema)
  .max(1000)
  .default([])
  .transform((list) => [...new Set(list)]);
/**
 * Testbetrieb: Empfängerkreise für IT-Mitarbeitende und alle übrigen (beide «all» = normaler Betrieb), dazu abweichende
 * Kreise je Auslöser; Auslöser, die im Block nicht vorkommen, fallen weg.
 */
const circlesSchema = (block: DeliveryBlock) =>
  z.object({
    staff: scope,
    others: scope,
    staffEmails: addressList,
    otherEmails: addressList,
    triggers: z
      .record(z.string(), scope)
      .default({})
      .transform((t) => Object.fromEntries(BLOCK_TRIGGERS[block].filter((k) => t[k]).map((k) => [k, t[k]!]))),
  });
/** Je ein Block für Mails ohne Typ, zu Störungen und zu Aufgaben */
const mailSchema = z.object({ general: circlesSchema('general'), incident: circlesSchema('incident'), task: circlesSchema('task') });
/** Portal: niemand, ausgewählte (Personen und AD-Gruppe) oder alle */
const portalSchema = z.object({
  access: scope,
  emails: addressList,
  groupDn: z.string().trim().max(500).default(''),
});
/** Bereiche der Rolle IT, in der Reihenfolge der Navigation */
const areasSchema = z.object({
  it: z
    .array(z.enum(AREAS))
    .min(1, 'Die IT muss mindestens einen Bereich sehen')
    .transform((list) => AREAS.filter((a) => list.includes(a))),
});
const microsoftSchema = z.object({
  clientId: z
    .string()
    .trim()
    .toLowerCase()
    .refine((id) => id === '' || /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(id), {
      message: 'Die Anwendungs-ID hat das Format 00000000-0000-0000-0000-000000000000',
    }),
});

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
    private readonly tls: TlsService,
    private readonly portalAccess: PortalAccessService,
    private readonly areas: AreasService,
  ) {}

  /** Angaben für Login-Seite und Kopfzeile. */
  @Public()
  @Get('public/info')
  async info() {
    const [general, logo, mail, setupRequired] = await Promise.all([
      this.settings.get('general'),
      this.settings.get('logo'),
      this.settings.get('mail'),
      this.auth.isSetupRequired(),
    ]);
    return {
      appName: general.appName,
      // Für die Beschriftung der abgeschlossenen Spalten der Boards («letzte 5 Tage»)
      boardClosedDays: general.boardClosedDays,
      hasLogo: !!logo,
      logoVersion: logo?.storageKey.slice(-8) ?? null,
      setupRequired,
      // Testbetrieb: Hinweis oben; je Block die Kreise der öffentlichen Antwort für den Vermerk im Antwortfeld
      testMode: !isLive(mail),
      delivery: Object.fromEntries(
        DELIVERY_BLOCKS.map((b) => {
          const reply = triggerCircles(mail[b], 'reply');
          return [b, { staff: reply.staff, others: reply.others }];
        }),
      ),
      // Für den Hinweis an Admins vor Ablauf; das Zertifikat ist ohnehin öffentlich
      certificateExpiresAt: this.tls.expiresAt,
    };
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
  @Audit('admin', 'Allgemeine Einstellungen geändert')
  @Put('settings/general')
  async updateGeneral(@Body(new ZodPipe(generalSchema)) body: z.infer<typeof generalSchema>) {
    const current = await this.settings.get('general');
    const general = { ...current, appName: body.appName, boardClosedDays: body.boardClosedDays ?? current.boardClosedDays };
    await this.settings.set('general', general);
    return general;
  }

  @AdminOnly()
  @Get('settings/mail')
  async mail() {
    const mail = await this.settings.get('mail');
    // Ältere Einstellungen haben noch keine Auslöser
    return Object.fromEntries(DELIVERY_BLOCKS.map((b) => [b, { ...mail[b], triggers: mail[b].triggers ?? {} }]));
  }

  /** Testbetrieb: Empfängerkreise. Zurückgehaltene Mails werden später nicht nachträglich versendet. */
  @AdminOnly()
  @Audit('admin', 'Testbetrieb geändert')
  @Put('settings/mail')
  async updateMail(@Body(new ZodPipe(mailSchema)) body: z.infer<typeof mailSchema>) {
    await this.settings.set('mail', body);
    return body;
  }

  /** Mit der Adresse des Portals (aus PUBLIC_URL wie die Links in den Mails) */
  @AdminOnly()
  @Get('settings/portal')
  async portal() {
    return { ...(await this.settings.get('portal')), url: `${appConfig.publicUrl}/portal` };
  }

  /** Wer das Portal nutzen darf. Gilt sofort, auch für bereits angemeldete Melder. */
  @AdminOnly()
  @Audit('admin', 'Zugang zum Portal geändert')
  @Put('settings/portal')
  async updatePortal(@Body(new ZodPipe(portalSchema)) body: z.infer<typeof portalSchema>) {
    await this.settings.set('portal', body);
    this.portalAccess.forget();
    return { ...body, url: `${appConfig.publicUrl}/portal` };
  }

  /** Bereiche des angemeldeten Benutzers (Navigation, Weiterleitung beim Anmelden) */
  @Get('areas')
  async myAreas(@CurrentUser() user: User) {
    return { areas: await this.areas.of(user) };
  }

  @AdminOnly()
  @Get('settings/areas')
  areaSettings() {
    return this.settings.get('areas');
  }

  /** Welche Bereiche die Rolle IT sieht (mindestens einer). Gilt sofort, auch für angemeldete Benutzer. */
  @AdminOnly()
  @Audit('admin', 'Bereiche je Rolle geändert')
  @Put('settings/areas')
  async updateAreas(@Body(new ZodPipe(areasSchema)) body: z.infer<typeof areasSchema>) {
    await this.settings.set('areas', body);
    return body;
  }

  /** Anwendungs-ID und, mit HTTPS, die Rücksprungadresse für die App-Registrierung. */
  @AdminOnly()
  @Get('settings/microsoft')
  async microsoft() {
    return { ...(await this.settings.get('microsoft')), callbackUrl: callbackUrl(appConfig.publicUrl) };
  }

  @AdminOnly()
  @Audit('admin', 'Einstellungen Microsoft geändert')
  @Put('settings/microsoft')
  async updateMicrosoft(@Body(new ZodPipe(microsoftSchema)) body: z.infer<typeof microsoftSchema>) {
    await this.settings.set('microsoft', body);
    return body;
  }

  @AdminOnly()
  @Audit('admin', 'Eigenes Logo hochgeladen')
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
  @Audit('admin', 'Eigenes Logo entfernt')
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
  @Audit('admin', 'Einstellungen LDAP geändert')
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
  @NoAudit()
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
