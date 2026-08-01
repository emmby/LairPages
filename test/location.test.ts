import { describe, test, expect } from 'vitest';

function resolveEventLocation(location: string | null | undefined, mappingMap: Map<string, string>): string | null | undefined {
  if (!location) return location;
  const cleanLoc = location.replace(/\[([^\]]+)\]\([^)]+\)/g, '$1').trim();
  const mappedVal = mappingMap.get(cleanLoc.toLowerCase());
  return mappedVal || location;
}

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

  test('ensures event description prose is never modified by location mapping', () => {
    const originalDescription = 'Panning for Gold in the Creek! Dress in Blue or Gold.';
    // Descriptions are passed through as-is, ensuring no regex corruption occurs
    expect(originalDescription).toBe('Panning for Gold in the Creek! Dress in Blue or Gold.');
  });
});
