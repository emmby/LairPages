import { describe, it, expect } from 'vitest';
import { cleanBanner, step4PostProcessFlow } from '../src/flows/step4-postprocess.js';

describe('cleanBanner', () => {
  it('converts bold HTML tags to markdown', () => {
    expect(cleanBanner('<b>Adult Swim</b>')).toBe('**Adult Swim**');
  });

  it('converts italic HTML tags to markdown', () => {
    expect(cleanBanner('<i>Note:</i> swim at your own risk')).toBe('_Note:_ swim at your own risk');
  });

  it('converts line breaks to newlines or spaces', () => {
    expect(cleanBanner('Line 1<br/>Line 2')).toBe('Line 1\nLine 2');
  });

  it('returns null for null or empty banner', () => {
    expect(cleanBanner(null)).toBeNull();
    expect(cleanBanner('')).toBeNull();
  });
});

describe('step4PostProcessFlow banner cleaning', () => {
  it('cleans track banner HTML during post-processing', async () => {
    const input = {
      step0: {
        metadata: {
          year: 2026,
          camp: 'blue' as const,
          week: 1,
          startDate: '2026-06-20',
        },
        tracks: [
          {
            name: 'Pool',
            banner: '<b>Adult Swim</b><br/><i>Note:</i> Swim at own risk',
            cells: [{ colA: 'Saturday', colB: '14:00', colC: 'Open Swim' }],
          },
        ],
      },
      step3: {
        tracks: [
          {
            trackName: 'Pool',
            events: [
              {
                startTime: '2026-06-20T14:00:00-07:00',
                endTime: '2026-06-20T15:00:00-07:00',
                title: 'Open Swim',
                location: 'Pool',
                description: 'Open swimming session',
              },
            ],
          },
        ],
      },
    };

    const result = await step4PostProcessFlow(input);
    expect(result.tracks[0].banner).toBe('**Adult Swim**\n_Note:_ Swim at own risk');
  });
});
