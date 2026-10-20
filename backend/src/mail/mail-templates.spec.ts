import { describe, expect, it, vi } from 'vitest';
import { composeMail, exampleValues, fill, templateByKey, TEMPLATES } from './mail-templates';
import { MailTemplatesService } from './mail-templates.service';

describe('Platzhalter', () => {
  it('ersetzt {{Name}} ohne Rücksicht auf Gross-/Kleinschreibung, unbekannte bleiben stehen', () => {
    expect(fill('Guten Tag {{ melder }}, zu {{Nummer}} «{{Titel}}». {{Gruss}}', { Melder: 'Anna', Nummer: 'PW-1', Titel: 'VPN' })).toBe(
      'Guten Tag Anna, zu PW-1 «VPN». {{Gruss}}',
    );
    expect(fill('{{Zugewiesen durch}}', { 'Zugewiesen durch': 'Regel «Drucker»' })).toBe('Regel «Drucker»');
  });

  it('jede Vorlage nennt alle Platzhalter, die ihr Standardtext braucht', () => {
    for (const t of TEMPLATES) {
      const used = [...`${t.subject ?? ''} ${t.body ?? ''}`.matchAll(/\{\{\s*([^{}]+?)\s*\}\}/g)].map((m) => m[1]);
      const known = t.placeholders.map((p) => p.name);
      expect(used.filter((name) => !known.includes(name!)), t.key).toEqual([]);
    }
  });
});

describe('Fertige Mail', () => {
  const values = { Nummer: 'PW-12', Titel: 'Fehler bei *.pdf und _Daten_', Link: 'https://pw.firma.local/portal/v/12', App: 'Patchwork' };

  it('Text wörtlich, HTML maskiert: Zeichen aus Titeln lösen keine Formatierung aus', () => {
    const mail = composeMail(
      { body: 'Zu «{{Titel}}» ({{Nummer}})', link: '[Ihre Meldung online ansehen]({{Link}})', footer: '{{App}} · {{Nummer}}' },
      values,
    );
    expect(mail.text).toBe(
      'Zu «Fehler bei *.pdf und _Daten_» (PW-12)\n\nIhre Meldung online ansehen: https://pw.firma.local/portal/v/12\n\n-- \nPatchwork · PW-12',
    );
    expect(mail.html).toContain('Zu «Fehler bei *.pdf und _Daten_» (PW-12)');
    expect(mail.html).not.toContain('<em>');
    expect(mail.html).toContain('<a href="https://pw.firma.local/portal/v/12">Ihre Meldung online ansehen</a>');
    expect(mail.html).toContain('Patchwork · PW-12</div>');
  });

  it('übernimmt den Text des Bearbeiters unverändert (Markdown)', () => {
    const mail = composeMail({ body: '**Erledigt** {{Titel}}', link: '', footer: '', written: true }, values);
    expect(mail.text).toBe('**Erledigt** {{Titel}}');
    expect(mail.html).toContain('<strong>Erledigt</strong> {{Titel}}');
  });

  it('HTML aus Werten wird nie übernommen', () => {
    const mail = composeMail({ body: '{{Text}}', link: '', footer: '' }, { Text: '<script>alert(1)</script>' });
    expect(mail.html).not.toContain('<script>');
  });
});

describe('Vorlagen verwalten', () => {
  function service(stored: Record<string, unknown> = {}) {
    const values: Record<string, unknown> = { mailTemplates: stored, general: { appName: 'Patchwork' } };
    const settings = {
      get: vi.fn(async (key: string) => values[key]),
      set: vi.fn(async (key: string, value: unknown) => {
        values[key] = value;
      }),
    };
    return { templates: new MailTemplatesService(settings as never), values };
  }

  it('speichert nur Abweichungen vom Standard und setzt zurück', async () => {
    const { templates, values } = service();
    const standard = templateByKey('done')!;
    await templates.save('done', { subject: standard.subject, body: 'Hallo {{Melder}}\r\n\r\nErledigt.' });
    expect(values.mailTemplates).toEqual({ done: { body: 'Hallo {{Melder}}\n\nErledigt.' } });
    expect(await templates.get('done')).toEqual({ subject: standard.subject, body: 'Hallo {{Melder}}\n\nErledigt.' });
    expect((await templates.list()).find((t) => t.key === 'done')?.custom).toBe(true);

    await templates.save('done', { subject: standard.subject, body: standard.body });
    expect(values.mailTemplates).toEqual({});
    await templates.save('reply', { subject: 'Antwort zu {{Titel}}', body: 'wird ignoriert' });
    expect(values.mailTemplates).toEqual({ reply: { subject: 'Antwort zu {{Titel}}' } });
    await templates.reset('reply');
    expect(values.mailTemplates).toEqual({});
    await expect(templates.save('gibtsnicht' as never, { subject: null, body: null })).rejects.toThrow(/nicht gefunden/);
  });

  it('Vorschau mit Beispieldaten, Rahmen in einer Beispielmail', async () => {
    const { templates } = service({ reporterFooter: { body: 'Ihre IT · {{Nummer}}' } });
    const rejected = await templates.preview('rejected', { subject: 'Leider nein: {{Titel}}', body: 'Grund: {{Begründung}}' });
    expect(rejected.subject).toBe('[PW-123] Leider nein: Drucker druckt nicht');
    expect(rejected.text).toContain(`Grund: ${exampleValues(templateByKey('rejected')!).Begründung}`);
    expect(rejected.text).toContain('-- \nIhre IT · PW-123');

    const footer = await templates.preview('staffFooter', { subject: null, body: 'IT-Team · {{Nummer}}' });
    expect(footer.subject).toBe('[PW-123] Zugewiesen: Drucker druckt nicht');
    expect(footer.text).toContain('-- \nIT-Team · PW-123');
    expect((await templates.preview('reply', { subject: '{{Titel}}', body: null })).text).toContain('Der Drucker ist wieder eingerichtet');
  });
});
