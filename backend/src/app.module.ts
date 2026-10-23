import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { AuthController } from './auth/auth.controller';
import { AuthGuard } from './auth/auth.guard';
import { AuthService } from './auth/auth.service';
import { ChannelsController } from './channels/channels.controller';
import { ChannelsService } from './channels/channels.service';
import { LdapService } from './auth/ldap.service';
import { SessionService } from './auth/session.service';
import { DbModule } from './db/db.module';
import { ChecklistsController } from './items/checklists.controller';
import { ChecklistsService } from './items/checklists.service';
import { ItemsController } from './items/items.controller';
import { ItemsService } from './items/items.service';
import { LinksController } from './items/links.controller';
import { LinksService } from './items/links.service';
import { BossService } from './jobs/boss.service';
import { MaintenanceService } from './jobs/maintenance.service';
import { GraphMailService } from './mail/graph-mail.service';
import { IncomingMailsController } from './mail/incoming-mails.controller';
import { OutgoingMailsController } from './mail/outgoing-mails.controller';
import { MailFetcherService } from './mail/mail-fetcher.service';
import { MailSimulationService } from './mail/mail-simulation.service';
import { MailTemplatesController } from './mail/mail-templates.controller';
import { MailTemplatesService } from './mail/mail-templates.service';
import { MailSenderService } from './mail/mail-sender.service';
import { MailTransportService } from './mail/mail-transport.service';
import { MailboxesController, MailboxOptionsController, MicrosoftCallbackController } from './mail/mailboxes.controller';
import { MailboxesService } from './mail/mailboxes.service';
import { MicrosoftAuthService } from './mail/microsoft-auth.service';
import { NotificationsService } from './mail/notifications.service';
import { PortalAccessService } from './portal/portal-access.service';
import { PortalController } from './portal/portal.controller';
import { PortalService } from './portal/portal.service';
import { ReportsController } from './reports/reports.controller';
import { ReportsService } from './reports/reports.service';
import { AutomationService } from './rules/automation.service';
import { DueRemindersService } from './rules/due-reminders.service';
import { RulesController } from './rules/rules.controller';
import { RulesService } from './rules/rules.service';
import { AreasService } from './settings/areas';
import { SettingsController } from './settings/settings.controller';
import { SettingsService } from './settings/settings.service';
import { SnippetsController } from './snippets/snippets.controller';
import { SnippetsService } from './snippets/snippets.service';
import { StatusesController } from './statuses/statuses.controller';
import { StatusesService } from './statuses/statuses.service';
import { StorageService } from './storage/storage.service';
import { TlsController } from './tls/tls.controller';
import { TlsService } from './tls/tls.service';
import { PublicImagesController } from './uploads/public-images.controller';
import { UploadsController } from './uploads/uploads.controller';
import { UploadsService } from './uploads/uploads.service';
import { UsersController } from './users/users.controller';
import { UsersService } from './users/users.service';

@Module({
  imports: [DbModule],
  controllers: [
    AuthController,
    SettingsController,
    UsersController,
    StatusesController,
    ChannelsController,
    ItemsController,
    ChecklistsController,
    LinksController,
    PortalController,
    MailboxesController,
    MailboxOptionsController,
    MicrosoftCallbackController,
    OutgoingMailsController,
    IncomingMailsController,
    MailTemplatesController,
    RulesController,
    SnippetsController,
    ReportsController,
    TlsController,
    UploadsController,
    PublicImagesController,
  ],
  providers: [
    { provide: APP_GUARD, useClass: AuthGuard },
    SessionService,
    AuthService,
    LdapService,
    SettingsService,
    AreasService,
    StorageService,
    UsersService,
    StatusesService,
    ChannelsService,
    ItemsService,
    ChecklistsService,
    LinksService,
    PortalService,
    PortalAccessService,
    BossService,
    MaintenanceService,
    MailTransportService,
    MailboxesService,
    MicrosoftAuthService,
    GraphMailService,
    MailSenderService,
    MailTemplatesService,
    NotificationsService,
    MailFetcherService,
    MailSimulationService,
    RulesService,
    AutomationService,
    DueRemindersService,
    SnippetsService,
    ReportsService,
    TlsService,
    UploadsService,
  ],
})
export class AppModule {}
