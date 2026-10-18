import { chartImage, type ChartSpec } from './charts';

export interface PdfReport {
  title: string;
  subtitle: string;
  /** Kennzahlen als «Bezeichnung: Wert» */
  facts: [string, string][];
  charts: { spec: ChartSpec; height: number }[];
  tables: { title: string; head: string[]; body: string[][]; empty: string }[];
}

const PAGE_HEIGHT = 297;
const MARGIN = 15;
const WIDTH = 210 - 2 * MARGIN;

/** Ganzer Bericht als PDF (A4 hoch). Die Bibliotheken werden erst beim Export geladen. */
export async function reportPdf(report: PdfReport): Promise<Blob> {
  const [{ jsPDF }, { autoTable }] = await Promise.all([import('jspdf'), import('jspdf-autotable')]);
  const doc = new jsPDF({ unit: 'mm', format: 'a4', compress: true });
  let y = MARGIN;
  const ensure = (height: number) => {
    if (y + height > PAGE_HEIGHT - MARGIN) {
      doc.addPage();
      y = MARGIN;
    }
  };

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(18);
  doc.text(report.title, MARGIN, y + 6);
  y += 10;
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(10);
  doc.setTextColor(93, 104, 121);
  doc.text(report.subtitle, MARGIN, y + 4);
  y += 10;

  doc.setTextColor(28, 35, 48);
  for (const [label, value] of report.facts) {
    doc.setFont('helvetica', 'bold');
    doc.text(`${label}:`, MARGIN, y + 4);
    doc.setFont('helvetica', 'normal');
    doc.text(value, MARGIN + 62, y + 4);
    y += 6;
  }
  y += 4;

  for (const { spec, height } of report.charts) {
    // Bild in doppelter Auflösung, damit es im PDF scharf bleibt
    const pxWidth = 1400;
    const pxHeight = Math.round((pxWidth * height) / WIDTH);
    ensure(height);
    // «FAST» komprimiert die Bilddaten, sonst wird das PDF mehrere MB gross
    doc.addImage(chartImage(spec, pxWidth, pxHeight), 'PNG', MARGIN, y, WIDTH, height, undefined, 'FAST');
    y += height + 6;
  }

  for (const table of report.tables) {
    ensure(20);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(12);
    doc.text(table.title, MARGIN, y + 5);
    y += 8;
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(10);
    if (table.body.length === 0) {
      doc.setTextColor(138, 148, 163);
      doc.text(table.empty, MARGIN, y + 4);
      doc.setTextColor(28, 35, 48);
      y += 10;
      continue;
    }
    autoTable(doc, {
      startY: y,
      head: [table.head],
      body: table.body,
      margin: { left: MARGIN, right: MARGIN },
      styles: { font: 'helvetica', fontSize: 9, cellPadding: 1.8 },
      headStyles: { fillColor: [241, 243, 246], textColor: [28, 35, 48] },
    });
    y = (doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY + 8;
  }

  // Fusszeile auf allen Seiten
  const pages = doc.getNumberOfPages();
  const created = new Intl.DateTimeFormat('de-CH', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date());
  for (let page = 1; page <= pages; page++) {
    doc.setPage(page);
    doc.setFontSize(8);
    doc.setTextColor(138, 148, 163);
    doc.text(`Erstellt am ${created}`, MARGIN, PAGE_HEIGHT - 8);
    doc.text(`Seite ${page} von ${pages}`, 210 - MARGIN, PAGE_HEIGHT - 8, { align: 'right' });
  }
  return doc.output('blob');
}
