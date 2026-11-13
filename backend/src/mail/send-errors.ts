import { GraphError } from './graph-mail.service';

/**
 * Dauerhafter Fehler einer einzelnen Mail (Entscheid vom 13.11.2026): Der Server lehnt genau diese Mail ab, z.B.
 * Empfänger unbekannt oder Mail zu gross. Sie wird nicht automatisch wiederholt und hält die übrigen Mails des
 * Postfachs nicht auf.
 *
 * Vorübergehend ist alles andere, weil es das ganze Postfach betrifft oder von selbst vorbeigeht: Server nicht
 * erreichbar, Zeitüberschreitung, Anmeldung, Absender nicht erlaubt, vorübergehende Ablehnung (SMTP 4xx), bei Microsoft
 * Graph Anmeldung, Rechte, Drosselung (429) und Serverfehler. Dann wiederholt Patchwork, und neuere Mails warten.
 */
export function isPermanentSendError(err: unknown): boolean {
  if (err instanceof GraphError) return err.status === 400 || err.status === 413;
  const e = err as { responseCode?: unknown; command?: unknown; code?: unknown };
  if (typeof e.responseCode !== 'number' || e.responseCode < 500 || e.responseCode > 599) return false;
  // SMTP (nodemailer): Ablehnung beim Empfänger oder beim Inhalt; beim Absender (MAIL FROM) oder bei der Anmeldung
  // liegt es am Postfach
  // (nodemailer meldet Absender und Empfänger beide als EENVELOPE, massgebend ist der Befehl)
  const command = typeof e.command === 'string' ? e.command.toUpperCase() : '';
  if (command) return command.startsWith('RCPT') || command === 'DATA';
  return e.code === 'EMESSAGE';
}
