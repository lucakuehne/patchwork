import { describe, expect, it } from 'vitest';
import { imapFolders, sortFolders, type MailFolder } from './mail-folders';

const folder = (path: string, extra: Partial<Record<string, unknown>> = {}) => {
  const parts = path.split('.');
  return {
    path,
    name: parts.at(-1)!,
    parent: parts.slice(0, -1),
    delimiter: '.',
    flags: new Set<string>(),
    listed: true,
    ...extra,
  };
};

describe('Ordner per IMAP', () => {
  it('liefert die wählbaren Ordner, den Posteingang samt Unterordnern zuerst', async () => {
    const client = {
      list: async () => [
        folder('Archiv'),
        folder('INBOX.Helpdesk'),
        folder('Sent', { specialUse: '\\Sent' }),
        folder('INBOX', { specialUse: '\\Inbox' }),
        folder('Gruppen', { flags: new Set(['\\Noselect']) }),
        folder('Alt', { listed: false }),
      ],
    };

    expect(await imapFolders(client as never)).toEqual([
      { id: null, path: 'INBOX', names: ['INBOX'], inbox: true },
      { id: null, path: 'INBOX.Helpdesk', names: ['INBOX', 'Helpdesk'], inbox: false },
      { id: null, path: 'Archiv', names: ['Archiv'], inbox: false },
      { id: null, path: 'Sent', names: ['Sent'], inbox: false },
    ]);
  });
});

describe('Reihenfolge der Ordner', () => {
  it('sortiert nach Namen, Unterordner direkt nach ihrem Ordner, Zahlen natürlich', () => {
    const f = (...names: string[]): MailFolder => ({ id: names.join('/'), path: names.join('/'), names, inbox: false });
    const sorted = sortFolders([f('Projekte', 'P10'), f('archiv'), f('Projekte 2'), f('Projekte', 'P9'), f('Projekte')]);
    expect(sorted.map((x) => x.path)).toEqual(['archiv', 'Projekte', 'Projekte/P9', 'Projekte/P10', 'Projekte 2']);
  });
});
