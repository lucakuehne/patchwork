/**
 * Höchstlänge eines Titels, der in Patchwork oder im Portal eingegeben wird (Entscheid vom 05.11.2026, zuerst 75,
 * gleichentags auf 90 erhöht). Titel aus Mail-Betreffen, simulierten Mails und dem HelpSpot-Import dürfen länger sein;
 * sie gelten erst, wenn jemand den Titel bearbeitet.
 */
export const TITLE_MAX = 90;
export const TITLE_TOO_LONG = `Der Titel darf höchstens ${TITLE_MAX} Zeichen lang sein.`;
