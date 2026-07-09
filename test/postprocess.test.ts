import { describe, test, expect } from 'vitest';
import { cleanDescription, normalizeAndTruncateDescription } from '../src/flows/step4-postprocess.js';

describe('cleanDescription formatting and escaping', () => {
  test('returns empty string for null or undefined input', () => {
    expect(cleanDescription(null)).toBe('');
    expect(cleanDescription(undefined)).toBe('');
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

describe('normalizeAndTruncateDescription', () => {
  test('converts to lowercase and removes HTML tags & non-alphanumeric characters', () => {
    const input = '<b>Hello</b> World! 123-456...';
    expect(normalizeAndTruncateDescription(input)).toBe('helloworld123456');
  });

  test('truncates to exactly 50 characters', () => {
    const input = 'a'.repeat(60);
    const expected = 'a'.repeat(50);
    expect(normalizeAndTruncateDescription(input)).toBe(expected);
    expect(normalizeAndTruncateDescription(input).length).toBe(50);
  });

  test('throws an error for null, undefined, or empty descriptions', () => {
    expect(() => normalizeAndTruncateDescription(null)).toThrow();
    expect(() => normalizeAndTruncateDescription(undefined)).toThrow();
    expect(() => normalizeAndTruncateDescription('   ')).toThrow();
  });

  test('throws an error if description has no alphanumeric characters', () => {
    expect(() => normalizeAndTruncateDescription('<b></b>!!!...')).toThrow();
  });
});

describe('Event ID Stability Hashing Logic', () => {
  function getMockEventIdInput(event: { title: string; description: string; startTime: string; endTime?: string | null }, trackName: string) {
    const normDesc = normalizeAndTruncateDescription(event.description);
    const cleanTrackForHash = trackName.toLowerCase().trim();
    return `${normDesc}_${event.startTime}_${event.endTime || ''}_${cleanTrackForHash}`;
  }

  test('changing the title does not change the hash input', () => {
    const event1 = {
      title: 'Original Title',
      description: 'Join us for arts and crafts in the arbor.',
      startTime: '2026-06-24T13:30:00-07:00',
    };
    const event2 = {
      title: 'Updated Title with Typo Fixed',
      description: 'Join us for arts and crafts in the arbor.',
      startTime: '2026-06-24T13:30:00-07:00',
    };

    const hash1 = getMockEventIdInput(event1, 'Arts and Crafts');
    const hash2 = getMockEventIdInput(event2, 'Arts and Crafts');
    expect(hash1).toBe(hash2);
  });

  test('changing the description changes the hash input', () => {
    const event1 = {
      title: 'Same Title',
      description: 'Join us for arts and crafts in the arbor.',
      startTime: '2026-06-24T13:30:00-07:00',
    };
    const event2 = {
      title: 'Same Title',
      description: 'Join us for pottery painting in the arbor.',
      startTime: '2026-06-24T13:30:00-07:00',
    };

    const hash1 = getMockEventIdInput(event1, 'Arts and Crafts');
    const hash2 = getMockEventIdInput(event2, 'Arts and Crafts');
    expect(hash1).not.toBe(hash2);
  });
});

