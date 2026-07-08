import { describe, test, expect } from 'vitest';
import { cleanDescription } from '../src/flows/step4-postprocess.js';

describe('cleanDescription formatting and escaping', () => {
  test('returns null for null or undefined input', () => {
    expect(cleanDescription(null)).toBeNull();
    expect(cleanDescription(undefined)).toBeNull();
  });

  test('escapes literal asterisks and backticks', () => {
    expect(cleanDescription('Special * warning')).toBe('Special \\* warning');
    expect(cleanDescription('Emphasis with _underscore_')).toBe('Emphasis with _underscore_');
    expect(cleanDescription('Code with `backtick`')).toBe('Code with \\`backtick\\`');
  });

  test('converts HTML bold tags to markdown bold tags', () => {
    expect(cleanDescription('<b>Hello World</b>')).toBe('**Hello World**');
    expect(cleanDescription('<strong>Hello World</strong>')).toBe('**Hello World**');
    expect(cleanDescription('<B>Hello World</B>')).toBe('**Hello World**');
    expect(cleanDescription('<b class="test">Hello World</b>')).toBe('**Hello World**');
    expect(cleanDescription('<b >Hello World</b>')).toBe('**Hello World**');
    expect(cleanDescription('<b>Hello\nWorld</b>')).toBe('**Hello\nWorld**');
  });

  test('converts HTML italic tags to markdown italic tags', () => {
    expect(cleanDescription('<i>Hello World</i>')).toBe('_Hello World_');
    expect(cleanDescription('<em>Hello World</em>')).toBe('_Hello World_');
    expect(cleanDescription('<I>Hello World</I>')).toBe('_Hello World_');
    expect(cleanDescription('<i style="color: red;">Hello World</i>')).toBe('_Hello World_');
  });

  test('handles combined HTML tags, literal symbols, and location links', () => {
    const input = '<b>Welcome Campers!</b> Come check-in at the [volleyball court](maplocation://oski/volleyball_court). *Late arrivals can check in at the store.';
    const expected = '**Welcome Campers!** Come check-in at the [Volleyball Court](maplocation://oski/volleyball_court). \\*Late arrivals can check in at the store.';
    expect(cleanDescription(input)).toBe(expected);
  });
});
