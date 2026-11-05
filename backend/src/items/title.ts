/**
 * Höchstlänge eines Titels, der in Patchwork oder im Portal eingegeben wird (Entscheid vom 05.11.2026). Titel aus
 * Mail-Betreffen, simulierten Mails und dem HelpSpot-Import dürfen länger sein; sie gelten erst, wenn jemand den Titel
 * bearbeitet.
 */
export const TITLE_MAX = 75;
export const TITLE_TOO_LONG = `Der Titel darf höchstens ${TITLE_MAX} Zeichen lang sein.`;
