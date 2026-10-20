import type { ImapFlow } from 'imapflow';

/** Ordner eines Postfachs zur Auswahl für den Abruf. */
export interface MailFolder {
  /** Microsoft Graph: ID des Ordners; IMAP: null */
  id: string | null;
  /** Gespeicherter Pfad: bei IMAP der Pfad des Servers, bei Microsoft Graph die Anzeigenamen mit «/» */
  path: string;
  /** Ordnernamen von oben nach unten, für die Anzeige */
  names: string[];
  /** Der Posteingang */
  inbox: boolean;
}

const collator = new Intl.Collator('de', { sensitivity: 'base', numeric: true });

/** Posteingang samt Unterordnern zuerst, sonst nach Namen; Unterordner folgen direkt auf ihren Ordner. */
export function sortFolders(folders: MailFolder[]): MailFolder[] {
  const inboxNames = folders.find((f) => f.inbox)?.names;
  const inInbox = (f: MailFolder) => !!inboxNames && inboxNames.every((name, i) => f.names[i] === name);
  return [...folders].sort((a, b) => {
    if (inInbox(a) !== inInbox(b)) return inInbox(a) ? -1 : 1;
    for (let i = 0; i < Math.min(a.names.length, b.names.length); i++) {
      const order = collator.compare(a.names[i]!, b.names[i]!);
      if (order !== 0) return order;
    }
    return a.names.length - b.names.length;
  });
}

/** IMAP: alle Ordner, die sich öffnen lassen (ohne \Noselect und nur abonnierte, aber fehlende Ordner). */
export async function imapFolders(client: ImapFlow): Promise<MailFolder[]> {
  const list = await client.list();
  return sortFolders(
    list
      .filter((f) => f.listed && !f.flags.has('\\Noselect') && !f.flags.has('\\NonExistent'))
      .map((f) => ({
        id: null,
        path: f.path,
        names: [...f.parent, f.name],
        inbox: f.specialUse === '\\Inbox' || f.path.toUpperCase() === 'INBOX',
      })),
  );
}
