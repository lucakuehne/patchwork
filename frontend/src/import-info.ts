import { formatDateTime } from './format';
import type { ImportInfo } from './types';

/** Importierte Mail (Entscheid vom 10.11.2026): wer importiert hat und das Sendedatum der Mail */
export const importNote = (info: ImportInfo) =>
  `importiert von ${info.by}${info.sentAt ? `, gesendet ${formatDateTime(info.sentAt)}` : ''}`;

/** Erklärung beim Darüberfahren */
export const importTitle = (info: ImportInfo) =>
  `Die Mail ging an eine andere Adresse und wurde von ${info.by} im Eingang importiert.`;
