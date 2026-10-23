import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { LdapService } from '../auth/ldap.service';
import { appConfig } from '../config';
import type { User } from '../db/schema';
import { SettingsService } from '../settings/settings.service';
import { composeMail, fill } from './mail-templates';
import { MailTemplatesService } from './mail-templates.service';
import { MailboxesService } from './mailboxes.service';
import { MailSenderService, newMessageId } from './mail-sender.service';
import { welcomeValues } from './welcome-mail';

/**
 * Willkommens-Mail an IT-Mitarbeitende und Admins, nur von Hand (Verwaltung → Benutzer). Ohne Vorgang: über das
 * Standard-Postfach, ohne Nummer im Betreff, ohne Link- und Fusszeile; im Testbetrieb wie jede Mail an die IT.
 */
@Injectable()
export class WelcomeMailService {
  private readonly logger = new Logger(WelcomeMailService.name);

  constructor(
    private readonly mailboxes: MailboxesService,
    private readonly sender: MailSenderService,
    private readonly templates: MailTemplatesService,
    private readonly settings: SettingsService,
    private readonly ldap: LdapService,
  ) {}

  async send(user: User): Promise<void> {
    if (!user.active || (user.role !== 'it' && user.role !== 'admin')) {
      throw new BadRequestException('Eine Willkommens-Mail gibt es nur für aktive Benutzer mit Rolle IT oder Admin.');
    }
    const mailbox = await this.mailboxes.forSending(null);
    if (!mailbox) throw new BadRequestException('Es ist kein aktives Postfach für den Versand eingerichtet.');
    const values = welcomeValues(user, await this.loginName(user), appConfig.publicUrl);
    const template = await this.templates.get('welcome');
    const { text, html } = composeMail({ body: template.body ?? '', link: '', footer: '' }, values);
    await this.sender.enqueue({
      mailboxId: mailbox.id,
      itemId: null,
      to: [user.email],
      cc: [],
      subject: fill(template.subject ?? '', values).replace(/\s+/g, ' ').trim() || 'Willkommen',
      text,
      html,
      messageId: newMessageId(mailbox),
      automated: true,
      template: 'welcome',
    });
  }

  /** Anmeldename eines AD-Kontos aus dem Verzeichnis; ist es nicht erreichbar, gilt die E-Mail-Adresse */
  private async loginName(user: User): Promise<string | null> {
    if (user.authSource !== 'ldap') return null;
    const cfg = await this.settings.get('ldap');
    if (!cfg.enabled) return null;
    try {
      return await this.ldap.loginName(cfg, user.email);
    } catch (err) {
      this.logger.warn(`Anmeldename von ${user.email} nicht abrufbar: ${this.ldap.explain(err)}`);
      return null;
    }
  }
}
