/** Datum JJJJ-MM-TT (ohne Uhrzeit) als TT.MM.JJJJ für Verlauf und Mails; null bleibt null. */
export const swissDate = (value: string | null) => (value ? value.split('-').reverse().join('.') : null);
