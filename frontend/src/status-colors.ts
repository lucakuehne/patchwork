import type { StatusColor } from './types';

/** Farben zur Auswahl für Status, mit Namen für die Auswahl (Werte in styles.css, hell und dunkel) */
export const STATUS_COLORS: { color: StatusColor; label: string }[] = [
  { color: 'gray', label: 'Grau' },
  { color: 'blue', label: 'Blau' },
  { color: 'teal', label: 'Türkis' },
  { color: 'green', label: 'Grün' },
  { color: 'yellow', label: 'Gelb' },
  { color: 'orange', label: 'Orange' },
  { color: 'red', label: 'Rot' },
  { color: 'pink', label: 'Pink' },
  { color: 'purple', label: 'Violett' },
  { color: 'brown', label: 'Braun' },
];
