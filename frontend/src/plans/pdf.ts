/**
 * Plan aus einem PDF (Entscheid vom 20.11.2026): Der Browser wandelt die gewählte Seite in ein Bild um (pdf.js,
 * Apache-2.0); gespeichert wird nur das Bild. pdf.js lädt erst, wenn jemand ein PDF wählt.
 */
type PdfJs = typeof import('pdfjs-dist');
let loading: Promise<PdfJs> | null = null;

function pdfjs(): Promise<PdfJs> {
  loading ??= (async () => {
    const [lib, worker] = await Promise.all([import('pdfjs-dist'), import('pdfjs-dist/build/pdf.worker.min.mjs?url')]);
    lib.GlobalWorkerOptions.workerSrc = worker.default;
    return lib;
  })();
  return loading;
}

/** Längere Seite des Bilds in Bildpunkten (A4 ergibt rund 300 dpi) */
const MAX_SIDE = 3600;

export interface PdfPages {
  count: number;
  /** Kleine Vorschau einer Seite (1-basiert) als Bild-URL */
  thumbnail(page: number, width?: number): Promise<string>;
  /** Seite als PNG in hoher Auflösung, weisser Hintergrund */
  render(page: number): Promise<{ blob: Blob; width: number; height: number }>;
  close(): void;
}

async function draw(doc: Awaited<ReturnType<PdfJs['getDocument']>['promise']>, n: number, scaleFor: (w: number, h: number) => number) {
  const page = await doc.getPage(n);
  const base = page.getViewport({ scale: 1 });
  const viewport = page.getViewport({ scale: scaleFor(base.width, base.height) });
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(viewport.width);
  canvas.height = Math.round(viewport.height);
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  await page.render({ canvas, canvasContext: ctx, viewport }).promise;
  return canvas;
}

export async function openPdf(file: File): Promise<PdfPages> {
  const lib = await pdfjs();
  const doc = await lib.getDocument({ data: new Uint8Array(await file.arrayBuffer()) }).promise;
  return {
    count: doc.numPages,
    async thumbnail(page, width = 160) {
      const canvas = await draw(doc, page, (w) => width / w);
      return canvas.toDataURL('image/png');
    },
    async render(page) {
      const canvas = await draw(doc, page, (w, h) => Math.min(MAX_SIDE / Math.max(w, h), 8));
      const blob = await new Promise<Blob>((resolve, reject) =>
        canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('Die Seite liess sich nicht in ein Bild umwandeln'))), 'image/png'),
      );
      return { blob, width: canvas.width, height: canvas.height };
    },
    close: () => void doc.destroy(),
  };
}

/** Grösse eines Bilds in Bildpunkten */
export function imageSize(file: Blob): Promise<{ width: number; height: number }> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      resolve({ width: img.naturalWidth, height: img.naturalHeight });
      URL.revokeObjectURL(url);
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('Das Bild liess sich nicht lesen'));
    };
    img.src = url;
  });
}
