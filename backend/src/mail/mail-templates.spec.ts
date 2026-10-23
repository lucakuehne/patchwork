import { describe, expect, it, vi } from 'vitest';
import {
  composeMail,
  exampleValues,
  fill,
  markdownAsText,
  personValues,
  sameText,
  templateByKey,
  TEMPLATES,
  TIMELINE_TEMPLATES,
  withoutDefaults,
} from './mail-templates';
import { MailTemplatesService } from './mail-templates.service';

const used = (text: string | null) => [...(text ?? '').matchAll(/\{\{\s*([^{}]+?)\s*\}\}/g)].map((m) => m[1]!);

describe('Mails im Verlauf', () => {
  it('alle Mails an Melder mit eigenem Text, ohne öffentliche Antwort und ohne Mails an die IT', () => {
    const expected = TEMPLATES.filter((t) => t.group === 'reporter' && t.subject !== null && t.body !== null).map((t) => t.key);
    expect([...TIMELINE_TEMPLATES].sort()).toEqual([...expected].sort());
    expect(TIMELINE_TEMPLATES).not.toContain('reply');
  });
});

describe('Platzhalter', () => {
  it('ersetzt {{Name}} ohne Rücksicht auf Gross-/Kleinschreibung und Leerzeichen, unbekannte bleiben stehen', () => {
    expect(
      fill('Guten Tag {{ melder  vorname }}, zu {{Nummer}} «{{Titel}}». {{Gruss}}', {
        'Melder Vorname': 'Anna',
        Nummer: 'PW-1',
        Titel: 'VPN',
      }),
    ).toBe('Guten Tag Anna, zu PW-1 «VPN». {{Gruss}}');
    expect(fill('{{Zugewiesen durch}}', { 'Zugewiesen durch': 'Regel «Drucker»' })).toBe('Regel «Drucker»');
  });

  it('jede Vorlage nennt alle Platzhalter, die ihr Standardtext braucht', () => {
    for (const t of TEMPLATES) {
      const known = t.placeholders.map((p) => p.name);
      expect([...used(t.subject), ...used(t.body)].filter((name) => !known.includes(name)), t.key).toEqual([]);
    }
  });

  it('Melder und Zuständig nur mit Vor- und Nachname, {{App}} gibt es nicht mehr', () => {
    for (const t of TEMPLATES) {
      const names = t.placeholders.map((p) => p.name);
      expect(names, t.key).not.toContain('App');
      expect(names, t.key).not.toContain('Melder');
      expect(names, t.key).not.toContain('Zuständig');
      expect([...used(t.subject), ...used(t.body)], t.key).not.toContain('App');
      // Link-Zeile und Fusszeile stehen in jeder Mail, dort nur Nummer, Titel und Link; Mails ohne Vorgang
      // (Willkommen) mit Vor- und Nachname der Person
      const expected =
        t.subject === null
          ? ['Nummer', 'Titel', 'Link']
          : t.standalone
            ? ['Vorname', 'Nachname', 'Link']
            : ['Melder Vorname', 'Melder Nachname', 'Zuständig Vorname', 'Zuständig Nachname'];
      expect(names, t.key).toEqual(expect.arrayContaining(expected));
      if (t.subject === null) expect(names, t.key).toHaveLength(3);
    }
    const examples = exampleValues(templateByKey('assigned')!);
    expect([examples['Melder Vorname'], examples['Melder Nachname']]).toEqual(['Anna', 'Muster']);
    expect([examples['Zuständig Vorname'], examples['Zuständig Nachname']]).toEqual(['Ivan', 'IT']);
  });

  it('Standardtexte mit Vor- und Nachname, per Du, Fusszeilen mit «Patchwork» (übernommen am 21.10.2026)', () => {
    expect(templateByKey('assigned')!.body).toContain('Melder: {{Melder Vorname}} {{Melder Nachname}} ({{Melder E-Mail}})');
    expect(templateByKey('confirmation')!.body).toMatch(/^Hallo \{\{Melder Vorname\}\}\n\nDeine Nachricht/);
    expect(templateByKey('reporterFooter')!.body).toBe('Patchwork · {{Nummer}}\nBitte lass bei Antworten die Nummer [{{Nummer}}] im Betreff stehen.');
    expect(templateByKey('staffFooter')!.body).toBe('Patchwork · Benachrichtigung zu {{Nummer}}');
  });

  it('mehrzeilige Werte im Zitat bleiben ganz im Zitat', () => {
    expect(fill('Antwort:\n\n> {{Text}}\n\nEnde', { Text: 'Zeile 1\nZeile 2\n\nAbsatz' })).toBe(
      'Antwort:\n\n> Zeile 1\n> Zeile 2\n> \n> Absatz\n\nEnde',
    );
    expect(fill('> > {{Text}}', { Text: 'a\nb' })).toBe('> > a\n> > b');
    // Ausserhalb eines Zitats unverändert
    expect(fill('Text: {{Text}}', { Text: 'a\nb' })).toBe('Text: a\nb');
    expect(fill('> Von {{Absender}}: {{Text}}', { Absender: 'Anna', Text: 'a\nb' })).toBe('> Von Anna: a\nb');
  });

  it('angepasste Texte, die dem Standard entsprechen, gelten wieder als Standard', () => {
    const confirmation = templateByKey('confirmation')!;
    expect(withoutDefaults({})).toBeNull();
    expect(withoutDefaults({ done: { subject: 'Fertig: {{Titel}}' } })).toBeNull();
    expect(
      withoutDefaults({
        confirmation: { body: `${confirmation.body}  \n` },
        done: { subject: 'Fertig: {{Titel}}', body: templateByKey('done')!.body! },
        alt: { body: 'unbekannte Vorlage' },
      }),
    ).toEqual({
      overrides: { done: { subject: 'Fertig: {{Titel}}' }, alt: { body: 'unbekannte Vorlage' } },
      removed: ['confirmation'],
    });
  });

  it('Beschreibungen nennen keine Status-Kategorien (gibt es seit 20.10.2026 nicht mehr)', () => {
    for (const t of TEMPLATES) expect(t.description, t.key).not.toMatch(/Kategorie/);
  });

  it('Vor- und Nachname einer Person, ohne Person leer', () => {
    expect(personValues('Melder', { firstName: 'Anna', lastName: 'Muster' })).toEqual({
      'Melder Vorname': 'Anna',
      'Melder Nachname': 'Muster',
    });
    expect(personValues('Zuständig', null)).toEqual({ 'Zuständig Vorname': '', 'Zuständig Nachname': '' });
    expect(personValues('Zuständig', undefined)).toEqual({ 'Zuständig Vorname': '', 'Zuständig Nachname': '' });
  });
});

describe('Fertige Mail', () => {
  const values = { Nummer: 'PW-12', Titel: 'Fehler bei *.pdf und _Daten_', Link: 'https://pw.firma.local/portal/v/12' };

  it('Text wörtlich, HTML maskiert: Zeichen aus Titeln lösen keine Formatierung aus', () => {
    const mail = composeMail(
      { body: 'Zu «{{Titel}}» ({{Nummer}})', link: '[Ihre Meldung online ansehen]({{Link}})', footer: 'IT · {{Nummer}}' },
      values,
    );
    expect(mail.text).toBe(
      'Zu «Fehler bei *.pdf und _Daten_» (PW-12)\n\nIhre Meldung online ansehen: https://pw.firma.local/portal/v/12\n\n-- \nIT · PW-12',
    );
    expect(mail.html).toContain('Zu «Fehler bei *.pdf und _Daten_» (PW-12)');
    expect(mail.html).not.toContain('<em>');
    expect(mail.html).toContain('<a href="https://pw.firma.local/portal/v/12">Ihre Meldung online ansehen</a>');
    expect(mail.html).toContain('IT · PW-12</div>');
  });

  it('Links im Text erscheinen in der Textfassung als «Text: Adresse», auch in öffentlichen Antworten', () => {
    const mail = composeMail({ body: 'Bitte [hier]({{Link}}) ansehen.', link: '', footer: '' }, { ...values, Link: 'https://x.test/1' });
    expect(mail.text).toBe('Bitte hier: https://x.test/1 ansehen.');
    expect(mail.html).toContain('<a href="https://x.test/1">hier</a>');
    const written = composeMail({ body: 'Siehe [Anleitung](https://x.test/a)', link: '', footer: '', written: true }, values);
    expect(written.text).toBe('Siehe Anleitung: https://x.test/a');
  });

  it('{{App}} ist kein Platzhalter mehr und bleibt stehen', () => {
    const mail = composeMail({ body: 'Gruss {{App}}', link: '', footer: '{{App}} · {{Nummer}}' }, values);
    expect(mail.text).toBe('Gruss {{App}}\n\n-- \n{{App}} · PW-12');
  });

  it('Markdown aus dem Editor: Text ohne Maskierungen und Entitäten, HTML formatiert', () => {
    const body =
      'Guten Tag {{Melder Vorname}} {{Melder Nachname}}  \nZu **{{Nummer}}**: A &amp; B &lt;C&gt; \\*nicht fett\\* \\[x\\]\n\n&nbsp;\n\nGruss';
    const mail = composeMail(
      { body, link: '[Ihre Meldung \\[online\\] ansehen]({{Link}})', footer: '' },
      { ...values, 'Melder Vorname': 'Anna', 'Melder Nachname': 'Muster' },
    );
    expect(mail.text).toBe(
      'Guten Tag Anna Muster\nZu **PW-12**: A & B <C> *nicht fett* [x]\n\nGruss\n\n' +
        'Ihre Meldung [online] ansehen: https://pw.firma.local/portal/v/12',
    );
    expect(mail.html).toContain('Guten Tag Anna Muster<br>');
    expect(mail.html).toContain('<strong>PW-12</strong>: A &amp; B &lt;C&gt; *nicht fett* [x]');
    expect(mail.html).toContain('<a href="https://pw.firma.local/portal/v/12">Ihre Meldung [online] ansehen</a>');
  });

  it('Link-Zeile: Platzhalter als Ziel auch mit Leerzeichen, Titel und Ziel in spitzen Klammern', () => {
    const url = values.Link;
    const line = (link: string) => composeMail({ body: '', link, footer: '' }, values);
    expect(line('[Ansehen]({{ Link }})').text).toBe(`Ansehen: ${url}`);
    expect(line('[Ansehen]({{ Link }})').html).toContain(`<a href="${url}">Ansehen</a>`);
    expect(line('[Ansehen]({{Link}} "Portal")').text).toBe(`Ansehen: ${url}`);
    expect(line('[Ansehen](<{{Link}}>)').text).toBe(`Ansehen: ${url}`);
    expect(line('[{{Link}}]({{Link}})').text).toBe(url);
    expect(line('Öffnen: {{Link}}').text).toBe(`Öffnen: ${url}`);
    expect(line('Öffnen: {{Link}}').html).toContain(`Öffnen: <a href="${url}">${url}</a>`);
  });

  it('Werte bleiben im Text wörtlich, auch wenn sie wie Maskierungen aussehen', () => {
    const mail = composeMail({ body: '{{Titel}}', link: '', footer: '' }, { Titel: 'C:\\Temp\\*.log &amp; mehr' });
    expect(mail.text).toBe('C:\\Temp\\*.log &amp; mehr');
    expect(mail.html).toContain('C:\\Temp\\*.log');
  });

  it('Begründung (Markdown aus dem Editor) im Text ohne Maskierungen', () => {
    const mail = composeMail({ body: 'Grund: {{Begründung}}', link: '', footer: '' }, { Begründung: 'A &amp; B, \\*nie\\*' });
    expect(mail.text).toBe('Grund: A & B, *nie*');
    expect(mail.html).toContain('Grund: A &amp; B, *nie*');
  });

  it('übernimmt den Text des Bearbeiters ohne Platzhalter (Markdown), Bilder bleiben für die Textfassung stehen', () => {
    const image = '![Fehler\\_1.png](attachment:0b6f1a2e-1c2d-4e5f-8a9b-0c1d2e3f4a5b)';
    const mail = composeMail({ body: `**Erledigt** {{Titel}} A &amp; B\n\n${image}`, link: '', footer: '', written: true }, values);
    expect(mail.text).toBe(`**Erledigt** {{Titel}} A & B\n\n${image}`);
    expect(mail.html).toContain('<strong>Erledigt</strong> {{Titel}} A &amp; B');
  });

  it('HTML aus Werten wird nie übernommen', () => {
    const mail = composeMail({ body: '{{Text}}', link: '', footer: '' }, { Text: '<script>alert(1)</script>' });
    expect(mail.html).not.toContain('<script>');
  });
});

describe('Text aus dem Editor', () => {
  it('Maskierungen, Entitäten, Zeilenumbrüche und leere Absätze', () => {
    expect(markdownAsText('a\\_b\\\\c &amp;amp; d  \ne\n\n&nbsp;\n\n&nbsp;\n\nf')).toBe('a_b\\c &amp; d\ne\n\nf');
    // Kein Satzzeichen: Backslash bleibt
    expect(markdownAsText('C:\\Temp')).toBe('C:\\Temp');
  });

  it('Zeilenumbrüche des Editors («  \\n») gelten beim Vergleich mit dem Standard nicht als Änderung', () => {
    expect(sameText('a  \nb\r\n', 'a\nb')).toBe(true);
    expect(sameText('a\n\nb', 'a\nb')).toBe(false);
  });
});

describe('Vorlagen verwalten', () => {
  function service(stored: Record<string, unknown> = {}) {
    const values: Record<string, unknown> = { mailTemplates: stored };
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
    await templates.save('done', { subject: standard.subject, body: 'Hallo {{Melder Vorname}}\r\n\r\nErledigt.' });
    expect(values.mailTemplates).toEqual({ done: { body: 'Hallo {{Melder Vorname}}\n\nErledigt.' } });
    expect(await templates.get('done')).toEqual({ subject: standard.subject, body: 'Hallo {{Melder Vorname}}\n\nErledigt.' });
    expect((await templates.list()).find((t) => t.key === 'done')?.custom).toBe(true);

    await templates.save('done', { subject: standard.subject, body: standard.body });
    expect(values.mailTemplates).toEqual({});
    await templates.save('reply', { subject: 'Antwort zu {{Titel}}', body: 'wird ignoriert' });
    expect(values.mailTemplates).toEqual({ reply: { subject: 'Antwort zu {{Titel}}' } });
    await templates.reset('reply');
    expect(values.mailTemplates).toEqual({});
    await expect(templates.save('gibtsnicht' as never, { subject: null, body: null })).rejects.toThrow(/nicht gefunden/);
  });

  it('der unveränderte Standard aus dem Editor gilt weiterhin als Standard', async () => {
    const { templates, values } = service();
    const standard = templateByKey('assigned')!;
    // So schreibt der Editor Zeilenumbrüche innerhalb eines Absatzes
    const fromEditor = standard.body!.replace(/\n/g, '  \n');
    await templates.save('assigned', { subject: standard.subject, body: fromEditor });
    expect(values.mailTemplates).toEqual({});
    await templates.save('assigned', { subject: standard.subject, body: `${fromEditor}  \nDanke` });
    expect(values.mailTemplates).toEqual({ assigned: { body: `${fromEditor}  \nDanke` } });
  });

  it('Vorschau mit Beispieldaten, Rahmen in einer Beispielmail', async () => {
    const { templates } = service({ reporterFooter: { body: 'Ihre IT · {{Nummer}}' } });
    const rejected = await templates.preview('rejected', { subject: 'Leider nein: {{Titel}}', body: 'Grund: {{Begründung}}' });
    expect(rejected.subject).toBe('[PW-123] Leider nein: Drucker druckt nicht');
    expect(rejected.text).toContain(`Grund: ${exampleValues(templateByKey('rejected')!).Begründung}`);
    expect(rejected.text).toContain('-- \nIhre IT · PW-123');

    const footer = await templates.preview('staffFooter', { subject: null, body: 'IT-Team · {{Nummer}}' });
    expect(footer.subject).toBe('[PW-123] Zugewiesen: Drucker druckt nicht');
    expect(footer.text).toContain('Melder: Anna Muster (anna.muster@firma.ch)');
    expect(footer.text).toContain('-- \nIT-Team · PW-123');
    expect((await templates.preview('reply', { subject: '{{Titel}}', body: null })).text).toContain('Der Drucker ist wieder eingerichtet');
  });

  it('Vorschau mit Vor- und Nachname, {{App}} bleibt stehen, Standard-Fusszeile', async () => {
    const { templates } = service();
    const confirmation = await templates.preview('confirmation', {
      subject: 'Für {{Melder Nachname}}',
      body: 'Hallo {{Melder Vorname}} {{Melder Nachname}}, es meldet sich {{Zuständig Vorname}} {{Zuständig Nachname}}. {{App}}',
    });
    expect(confirmation.subject).toBe('[PW-123] Für Muster');
    expect(confirmation.text).toContain('Hallo Anna Muster, es meldet sich Ivan IT. {{App}}');
    expect(confirmation.text).toContain('-- \nPatchwork · PW-123\nBitte lass bei Antworten die Nummer [PW-123] im Betreff stehen.');

    const staff = await templates.preview('staffLink', { subject: null, body: '[Öffnen]({{Link}})' });
    expect(staff.text).toContain('Öffnen: https://patchwork.firma.local/v/123\n\n-- \nPatchwork · Benachrichtigung zu PW-123');
    expect(staff.html).toContain('<a href="https://patchwork.firma.local/v/123">Öffnen</a>');
  });
});
