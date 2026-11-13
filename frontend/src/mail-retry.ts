import type { MailRetrySettings } from './types';

/** Abstände der Wiederholungen in Minuten (wie im Backend, mail-retry.ts) */
export function retryDelays(s: MailRetrySettings): number[] {
  return Array.from({ length: s.retries }, (_, i) =>
    s.doubling ? Math.min(s.firstDelayMinutes * 2 ** i, Math.max(s.maxDelayMinutes, s.firstDelayMinutes)) : s.firstDelayMinutes,
  );
}

const minutesText = (n: number) => (n === 1 ? '1 Minute' : `${n} Minuten`);

/** Gesamtdauer grob: «12 Minuten», «etwa 5 Stunden», «etwa 3 Tage» */
function durationText(minutes: number): string {
  if (minutes < 60) return minutesText(minutes);
  const hours = Math.round(minutes / 60);
  if (hours < 48) return `etwa ${hours === 1 ? '1 Stunde' : `${hours} Stunden`}`;
  return `etwa ${Math.round(hours / 24)} Tage`;
}

/** «1, 2 und 4» */
const list = (values: number[]) => (values.length > 1 ? `${values.slice(0, -1).join(', ')} und ${values.at(-1)}` : `${values[0]}`);

/**
 * Ablauf der Wiederholungen als Satz für die Einstellungen (Entscheid vom 13.11.2026), z.B. «Wiederholungen nach 1, 2,
 * 4, 8, 16 und 32 Minuten, danach 4-mal alle 60 Minuten. Die letzte kommt etwa 5 Stunden nach dem ersten Versuch.»
 */
export function retryPlanText(s: MailRetrySettings): string {
  const delays = retryDelays(s);
  if (!delays.length) return 'Keine Wiederholungen: Nach einem Fehler bleibt die Mail auf «Fehler», bis jemand «Erneut senden» wählt.';
  const total = delays.reduce((sum, d) => sum + d, 0);
  const last = `Die letzte kommt ${durationText(total)} nach dem ersten Versuch.`;
  if (delays.length === 1) return `Eine Wiederholung nach ${minutesText(delays[0]!)}.`;
  if (delays.every((d) => d === delays[0])) return `${delays.length} Wiederholungen alle ${minutesText(delays[0]!)}. ${last}`;
  // Am Ende gleiche Abstände (Obergrenze erreicht) zusammenfassen
  const cap = delays.at(-1)!;
  const firstCapped = delays.indexOf(cap);
  const rising = delays.slice(0, firstCapped);
  const repeated = delays.length - firstCapped;
  if (repeated >= 2 && rising.length) {
    return `Wiederholungen nach ${list(rising)} Minuten, danach ${repeated}-mal alle ${minutesText(cap)}. ${last}`;
  }
  return `Wiederholungen nach ${list(delays)} Minuten. ${last}`;
}
