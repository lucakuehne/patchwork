import { describe, expect, it } from 'vitest';
import { errorMessage } from './api';

describe('Meldungen', () => {
  it('Fehler und Hinweise als Text, sonst «Unbekannter Fehler»', () => {
    expect(errorMessage(new Error('Kaputt'))).toBe('Kaputt');
    expect(errorMessage('Die Wand muss im Umriss liegen.')).toBe('Die Wand muss im Umriss liegen.');
    expect(errorMessage('  ')).toBe('Unbekannter Fehler');
    expect(errorMessage(undefined)).toBe('Unbekannter Fehler');
  });
});
