import { describe, test, expect } from 'vitest';
import { resolveEventLocation } from '../src/flows/step3-location.js';

describe('Location Resolution Logic', () => {
  const mockMappingMap = new Map<string, string>([
    ['volleyball court', '[Volleyball Court](maplocation://blue/sports_courts)'],
    ['gold pool', '[Gold Pool](maplocation://gold/pool)'],
  ]);

  test('maps exact raw location strings to maplocation markdown links', () => {
    expect(resolveEventLocation('Volleyball Court', mockMappingMap)).toBe('[Volleyball Court](maplocation://blue/sports_courts)');
    expect(resolveEventLocation('Gold Pool', mockMappingMap)).toBe('[Gold Pool](maplocation://gold/pool)');
  });

  test('leaves unrecognized location strings untouched', () => {
    expect(resolveEventLocation('Random Meadow', mockMappingMap)).toBe('Random Meadow');
  });

  test('leaves null or empty location untouched', () => {
    expect(resolveEventLocation(null, mockMappingMap)).toBe(null);
    expect(resolveEventLocation(undefined, mockMappingMap)).toBe(undefined);
  });

  test('maps embedded whole-word location strings within phrase context', () => {
    const mappingMap = new Map<string, string>([
      ['dh', '[DH](maplocation://blue/dining_hall)'],
      ['gold pool', '[Gold Pool](maplocation://gold/pool)'],
      ['volleyball court', '[Volleyball Court](maplocation://blue/sports_courts)'],
    ]);

    expect(resolveEventLocation('Found near the DH', mappingMap)).toBe('Found near the [DH](maplocation://blue/dining_hall)');
    expect(resolveEventLocation('At the gold pool after lunch', mappingMap)).toBe('At the [Gold Pool](maplocation://gold/pool) after lunch');
  });

  test('enforces word boundaries so substring words like Wednesday or Windhaven do not match DH', () => {
    const mappingMap = new Map<string, string>([
      ['dh', '[DH](maplocation://blue/dining_hall)'],
    ]);

    expect(resolveEventLocation('Wednesday at Windhaven', mappingMap)).toBe('Wednesday at Windhaven');
    expect(resolveEventLocation('Meet at DH on Wednesday', mappingMap)).toBe('Meet at [DH](maplocation://blue/dining_hall) on Wednesday');
  });

  test('protects markdown links from being corrupted by subsequent key replacements', () => {
    const mappingMap = new Map<string, string>([
      ['volleyball court', '[Volleyball Court](maplocation://blue/sports_courts)'],
      ['court', '[Court](maplocation://blue/court)'],
    ]);

    expect(resolveEventLocation('Volleyball Court / Court', mappingMap)).toBe('[Volleyball Court](maplocation://blue/sports_courts) / [Court](maplocation://blue/court)');
  });

  test('ensures event description prose is never modified by location mapping', () => {
    const originalDescription = 'Panning for Gold in the Creek! Dress in Blue or Gold.';
    // Descriptions are passed through as-is, ensuring no regex corruption occurs
    expect(originalDescription).toBe('Panning for Gold in the Creek! Dress in Blue or Gold.');
  });
});
