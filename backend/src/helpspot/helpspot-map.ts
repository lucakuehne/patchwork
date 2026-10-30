import { htmlToText } from './helpspot-text';
import type { ItemType } from '../db/schema';
import type { HelpSpotAnalysis, HelpSpotSettings } from '../settings/settings.service';
import type { TargetsByType } from '../statuses/status-rules';
import { statusKey, type HsTicket } from './helpspot-ticket';

/**
 * Zuordnung der Werte aus HelpSpot zu Patchwork (Entscheid vom 29.10.2026): Typ (Feld «Type»), Status je Typ und
 * offen/geschlossen, Meldeweg («Eröffnet über»). Gespeicherte Zuordnungen gelten, für alles andere ein Vorschlag.
 */
export interface StatusOption {
  id: string;
  type: ItemType;
  closed: boolean;
}

export interface ChannelOption {
  id: string;
  label: string;
}

export interface MappingContext {
  targets: TargetsByType;
  statuses: StatusOption[];
  channels: ChannelOption[];
  /** Meldeweg der Mails */
  mailChannelId: string | null;
}

/** Incident und leer → Störung, Changes und Project → Aufgabe, alles andere Störung */
export const suggestType = (value: string): ItemType => (/^(changes?|projects?)$/i.test(value.trim()) ? 'task' : 'incident');

/** Offen → «Antwort führt in» (sonst Start), geschlossen → Schliessen-Ziel, «Not a problem» → Ablehnen-Ziel */
export function suggestStatus(type: ItemType, status: string, open: boolean, targets: TargetsByType): string | undefined {
  const t = targets[type];
  if (open) return t.reply ?? t.start;
  if (/not a problem|kein problem/i.test(status) && t.reject) return t.reject;
  return t.close;
}

/** Mail → Meldeweg der Mails, Telefon → Meldeweg «Telefon», sonst keiner */
export function suggestChannel(openedVia: string, ctx: Pick<MappingContext, 'channels' | 'mailChannelId'>): string | null {
  if (/^e-?mail$/i.test(openedVia.trim())) return ctx.mailChannelId;
  if (/phone|telefon/i.test(openedVia)) return ctx.channels.find((c) => /telefon|phone/i.test(c.label))?.id ?? null;
  return null;
}

/** Passt der Status zum Typ und zu offen/geschlossen? Geschlossene Tickets nur auf abgeschlossene Status, offene nur auf offene */
function validStatus(id: string | undefined, type: ItemType, open: boolean, ctx: MappingContext): string | undefined {
  const status = id ? ctx.statuses.find((s) => s.id === id) : undefined;
  return status && status.type === type && status.closed === !open ? status.id : undefined;
}

export const typeFor = (value: string, settings: Pick<HelpSpotSettings, 'types'>): ItemType =>
  settings.types[value] ?? suggestType(value);

export function statusFor(type: ItemType, status: string, open: boolean, settings: Pick<HelpSpotSettings, 'statuses'>, ctx: MappingContext) {
  return (
    validStatus(settings.statuses[statusKey(type, status, open)], type, open, ctx) ??
    validStatus(suggestStatus(type, status, open, ctx.targets), type, open, ctx)
  );
}

export function channelFor(openedVia: string, settings: Pick<HelpSpotSettings, 'channels'>, ctx: MappingContext): string | null {
  if (Object.hasOwn(settings.channels, openedVia)) {
    const id = settings.channels[openedVia];
    return id && ctx.channels.some((c) => c.id === id) ? id : null;
  }
  return suggestChannel(openedVia, ctx);
}

/** Typ, Status und Meldeweg eines Tickets; ohne passenden Status ein Fehler (z.B. ein Typ ohne Schliessen-Ziel) */
export function resolveTicket(t: HsTicket, settings: Pick<HelpSpotSettings, 'types' | 'statuses' | 'channels'>, ctx: MappingContext) {
  const type = typeFor(t.type, settings);
  const statusId = statusFor(type, t.status, t.open, settings, ctx);
  if (!statusId) throw new Error(`Kein passender Status für «${t.status}» (${t.open ? 'offen' : 'geschlossen'}) beim Typ ${type}`);
  return { type, statusId, channelId: channelFor(t.openedVia, settings, ctx) };
}

/** Zuordnungen für die Seite: für jeden Wert aus der Übersicht der gespeicherte oder vorgeschlagene */
export function effectiveMappings(settings: HelpSpotSettings, analysis: HelpSpotAnalysis | null, ctx: MappingContext) {
  const types: Record<string, ItemType> = {};
  for (const { value } of analysis?.types ?? []) types[value] = typeFor(value, settings);
  const statuses: Record<string, string | null> = {};
  for (const type of new Set(Object.values(types))) {
    for (const { status, open } of analysis?.statuses ?? []) {
      statuses[statusKey(type, status, open)] = statusFor(type, status, open, settings, ctx) ?? null;
    }
  }
  const channels: Record<string, string | null> = {};
  for (const { value } of analysis?.openedVia ?? []) channels[value] = channelFor(value, settings, ctx);
  return { types, statuses, channels };
}

/**
 * Kopie aus der Parallelphase: Vorschlag, welcher Vorgang bleibt (Entscheid vom 30.10.2026). Die Kopie in Patchwork,
 * wenn sie dort eine Aufgabe ist (Aufgaben laufen seit dem 28.10.2026 in Patchwork) oder Antworten bzw. Notizen der IT
 * hat; sonst der HS-Vorgang mit dem Verlauf aus HelpSpot. Eine verworfene Kopie bleibt nicht: Antworten landen nie bei
 * einem verworfenen Vorgang.
 */
export function suggestCopyKeep(
  copy: { type: ItemType | null; discarded: boolean },
  staffEntries: number,
): { keep: 'copy' | 'original'; reason: 'task' | 'staffEntries' | null } {
  if (copy.discarded) return { keep: 'original', reason: null };
  if (copy.type === 'task') return { keep: 'copy', reason: 'task' };
  if (staffEntries > 0) return { keep: 'copy', reason: 'staffEntries' };
  return { keep: 'original', reason: null };
}

/**
 * Text einer Änderung aus HelpSpot, eine Zeile je Änderung. Die Zeile «Request Changed:» fällt weg, im Verlauf steht
 * ohnehin «in HelpSpot geändert».
 */
export function changeText(note: string, html: boolean): string {
  return (html ? htmlToText(note) : note)
    .split(/\n+/)
    .map((line) => line.trim())
    .filter((line) => line && !/^Request Changed:?$/i.test(line))
    .join('\n');
}
