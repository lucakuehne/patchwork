import Image from '@tiptap/extension-image';
import { imageRef, imageUrl, type ImageContext } from './markdown-html';

/**
 * Bild im Text für den Editor: Im Markdown steht die Referenz («upload:<id>» bzw. «attachment:<id>»), angezeigt wird
 * die Adresse auf dem Server. Eingefügtes HTML übernimmt nur Bilder von Patchwork selbst («origin»), fremde fallen weg.
 */
export function textImage(options: { context: () => ImageContext; origin: string }) {
  // Referenz eines eingefügten Bilds: aus dem Editor selbst («data-ref») oder aus der Adresse (z.B. aus der Timeline)
  const refOf = (element: HTMLElement): string | null => {
    const own = element.getAttribute('data-ref');
    return own && imageUrl(own, 'staff') ? own : imageRef(element.getAttribute('src') ?? '', options.origin);
  };

  return Image.extend({
    addAttributes() {
      return {
        ...this.parent?.(),
        src: {
          default: null,
          parseHTML: refOf,
          renderHTML: (attributes: { src?: string | null }) => {
            const url = imageUrl(attributes.src ?? '', options.context());
            return { ...(url ? { src: url } : {}), 'data-ref': attributes.src };
          },
        },
      };
    },
    parseHTML() {
      return [{ tag: 'img[src]', getAttrs: (element) => (refOf(element) ? null : false) }];
    },
    // Getipptes «![…](…)» bleibt Text
    addInputRules() {
      return [];
    },
  }).configure({ inline: true });
}

/**
 * Inhalt zum Einfügen eines Bilds: das Bild in einem eigenen Absatz und darunter ein leerer, in dem der Cursor
 * danach steht. So schreibt man unter dem Bild weiter statt daneben.
 */
export function imageBlock(src: string, alt: string) {
  return [{ type: 'paragraph', content: [{ type: 'image', attrs: { src, alt } }] }, { type: 'paragraph' }];
}

/** Alternativtext aus dem Dateinamen; eckige Klammern und Zeilenumbrüche würden das Markdown des Bilds zerbrechen. */
export function imageAlt(filename: string): string {
  return filename.replace(/[[\]\r\n]+/g, ' ').trim() || 'Bild';
}

/** Enthält die Zwischenablage Text (z.B. aus Excel oder Word)? Dann gilt der Text, nicht das mitkopierte Bild. */
export function clipboardHasText(data: DataTransfer): boolean {
  const html = data.getData('text/html');
  if (html) return !!new DOMParser().parseFromString(html, 'text/html').body.textContent?.trim();
  return !!data.getData('text/plain').trim();
}
