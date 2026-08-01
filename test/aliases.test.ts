import { describe, test, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

describe('location_aliases.json validation gate', () => {
  const aliasesFilePath = path.resolve(process.cwd(), 'src/lib/location_aliases.json');
  const aliasesData = JSON.parse(fs.readFileSync(aliasesFilePath, 'utf-8'));
  const reservedCampNames = new Set(['oski', 'blue', 'gold']);

  test('validates location_aliases structure for all camps', () => {
    expect(aliasesData).toHaveProperty('oski');
    expect(aliasesData).toHaveProperty('blue');
    expect(aliasesData).toHaveProperty('gold');
  });

  test('ensures all alias lists are valid arrays', () => {
    for (const [camp, locations] of Object.entries<Record<string, string[]>>(aliasesData)) {
      for (const [locKey, aliasList] of Object.entries(locations)) {
        expect(
          Array.isArray(aliasList),
          `Camp "${camp}" location key "${locKey}" alias list must be an array`
        ).toBe(true);
      }
    }
  });

  test('ensures no alias matches a reserved camp name', () => {
    for (const [camp, locations] of Object.entries<Record<string, string[]>>(aliasesData)) {
      for (const [locKey, aliasList] of Object.entries(locations)) {
        expect(Array.isArray(aliasList)).toBe(true);
        for (const alias of aliasList) {
          const cleanAlias = alias.trim().toLowerCase();
          expect(
            reservedCampNames.has(cleanAlias),
            `Camp "${camp}" location key "${locKey}" has illegal alias "${alias}" matching reserved camp name`
          ).toBe(false);
        }
      }
    }
  });

  test('ensures aliases do not have leading or trailing whitespace', () => {
    for (const [camp, locations] of Object.entries<Record<string, string[]>>(aliasesData)) {
      for (const [locKey, aliasList] of Object.entries(locations)) {
        expect(Array.isArray(aliasList)).toBe(true);
        for (const alias of aliasList) {
          expect(alias).toBe(alias.trim());
        }
      }
    }
  });
});
