import { Injectable, NotFoundException } from '@nestjs/common';
import { SettingsService } from '../settings/settings.service';
import {
  composeMail,
  exampleValues,
  fill,
  sameText,
  templateByKey,
  TEMPLATES,
  type TemplateDefinition,
  type TemplateKey,
  type TemplateText,
} from './mail-templates';

/** Text des Bearbeiters in der Vorschau der öffentlichen Antwort */
const EXAMPLE_REPLY = 'Guten Tag Frau Muster\n\nDer Drucker ist wieder eingerichtet. Bitte melden Sie sich, falls noch etwas fehlt.\n\nFreundliche Grüsse\nIvan IT';

const normalize = (text: string) => text.replace(/\r\n?/g, '\n').trim();

/** E-Mail-Vorlagen: Standard aus dem Code, angepasste Fassungen in den Einstellungen («mailTemplates»). */
@Injectable()
export class MailTemplatesService {
  constructor(private readonly settings: SettingsService) {}

  /** Betreff und Text einer Vorlage, angepasst oder Standard. */
  async get(key: TemplateKey): Promise<TemplateText> {
    const definition = this.definition(key);
    const custom = (await this.settings.get('mailTemplates'))[key];
    return {
      subject: definition.subject === null ? null : (custom?.subject ?? definition.subject),
      body: definition.body === null ? null : (custom?.body ?? definition.body),
    };
  }

  /** Alle Vorlagen für die Verwaltung, mit Standard und aktueller Fassung. */
  async list() {
    const overrides = await this.settings.get('mailTemplates');
    return TEMPLATES.map((definition) => {
      const custom = overrides[definition.key];
      return {
        key: definition.key,
        group: definition.group,
        label: definition.label,
        description: definition.description,
        plain: !!definition.plain,
        placeholders: definition.placeholders,
        defaultSubject: definition.subject,
        defaultBody: definition.body,
        subject: definition.subject === null ? null : (custom?.subject ?? definition.subject),
        body: definition.body === null ? null : (custom?.body ?? definition.body),
        custom: !!custom,
      };
    });
  }

  /**
   * Speichert eine Vorlage; entspricht sie dem Standard, gilt wieder der Standard. Zeilenumbrüche aus dem Editor («  \n»)
   * zählen dabei nicht als Abweichung.
   */
  async save(key: TemplateKey, input: TemplateText): Promise<void> {
    const definition = this.definition(key);
    const overrides = { ...(await this.settings.get('mailTemplates')) };
    const entry: { subject?: string; body?: string } = {};
    if (definition.subject !== null && input.subject !== null && normalize(input.subject) !== definition.subject) {
      entry.subject = normalize(input.subject);
    }
    if (definition.body !== null && input.body !== null && !sameText(input.body, definition.body)) {
      entry.body = normalize(input.body);
    }
    if (Object.keys(entry).length > 0) overrides[key] = entry;
    else delete overrides[key];
    await this.settings.set('mailTemplates', overrides);
  }

  async reset(key: TemplateKey): Promise<void> {
    this.definition(key);
    const overrides = { ...(await this.settings.get('mailTemplates')) };
    delete overrides[key];
    await this.settings.set('mailTemplates', overrides);
  }

  /**
   * Vorschau mit Beispielwerten, so wie die Mail beim Empfänger aussieht, mit dem Entwurf statt der gespeicherten Fassung.
   * Link-Zeile und Fusszeile zeigt Patchwork in einer Eingangsbestätigung bzw. einer Mail «Zugewiesen».
   */
  async preview(key: TemplateKey, draft: TemplateText): Promise<{ subject: string; html: string; text: string }> {
    const definition = this.definition(key);
    const reporter = definition.group === 'reporter';
    const shown: TemplateKey = definition.subject === null ? (reporter ? 'confirmation' : 'assigned') : key;
    const version = async (k: TemplateKey): Promise<TemplateText> => (k === key ? draft : this.get(k));
    const [main, link, footer] = await Promise.all([
      version(shown),
      version(reporter ? 'reporterLink' : 'staffLink'),
      version(reporter ? 'reporterFooter' : 'staffFooter'),
    ]);
    const values: Record<string, string> = { ...exampleValues(this.definition(shown)), ...exampleValues(definition) };
    const composed = composeMail(
      {
        body: shown === 'reply' ? EXAMPLE_REPLY : (main.body ?? ''),
        link: link.body ?? '',
        footer: footer.body ?? '',
        written: shown === 'reply',
      },
      values,
    );
    return { subject: `[${values.Nummer}] ${fill(main.subject ?? '', values).trim()}`, ...composed };
  }

  private definition(key: string): TemplateDefinition {
    const definition = templateByKey(key);
    if (!definition) throw new NotFoundException('Vorlage nicht gefunden');
    return definition;
  }
}
