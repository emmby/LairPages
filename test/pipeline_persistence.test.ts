import { describe, test, expect, vi, beforeEach } from 'vitest';
import * as path from 'path';

// Hoisted state for fs mocking
const { mockFsState, mockStep5EvaluateFlow } = vi.hoisted(() => ({
  mockFsState: {
    writtenFiles: {} as Record<string, string>,
  },
  mockStep5EvaluateFlow: vi.fn(),
}));

// Mock fs
vi.mock('fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('fs')>();
  return {
    ...actual,
    default: {
      ...actual,
      existsSync: (p: any) => {
        const norm = String(p);
        if (norm.endsWith('week_01.pdf') || norm.endsWith('manifest.json')) return true;
        return actual.existsSync(p);
      },
      readFileSync: (p: any, opts: any) => {
        const norm = String(p);
        if (norm.endsWith('manifest.json')) {
          return JSON.stringify({
            camps: [{ id: 'testcamp', name: 'Test Camp' }],
            schedules: [],
          });
        }
        if (norm.endsWith('week_01.pdf')) {
          return Buffer.from('dummy pdf binary');
        }
        return actual.readFileSync(p, opts);
      },
      writeFileSync: (p: any, data: any) => {
        mockFsState.writtenFiles[String(p)] = String(data);
      },
      mkdirSync: () => undefined,
      copyFileSync: () => undefined,
      unlinkSync: () => undefined,
    },
    existsSync: (p: any) => {
      const norm = String(p);
      if (norm.endsWith('week_01.pdf') || norm.endsWith('manifest.json')) return true;
      return actual.existsSync(p);
    },
    readFileSync: (p: any, opts: any) => {
      const norm = String(p);
      if (norm.endsWith('manifest.json')) {
        return JSON.stringify({
          camps: [{ id: 'testcamp', name: 'Test Camp' }],
          schedules: [],
        });
      }
      if (norm.endsWith('week_01.pdf')) {
        return Buffer.from('dummy pdf binary');
      }
      return actual.readFileSync(p, opts);
    },
    writeFileSync: (p: any, data: any) => {
      mockFsState.writtenFiles[String(p)] = String(data);
    },
    mkdirSync: () => undefined,
    copyFileSync: () => undefined,
    unlinkSync: () => undefined,
  };
});

// Mock flows
vi.mock('../src/flows/step0-extract.js', () => ({
  step0ExtractFlow: vi.fn().mockResolvedValue({
    metadata: {
      year: 2099,
      camp: 'testcamp',
      week: 1,
      startDate: '2099-06-14',
    },
    pageCount: 1,
    transcription: 'Mock visual transcription',
  }),
}));

vi.mock('../src/flows/step1-events.js', () => ({
  step1EventsFlow: vi.fn().mockResolvedValue({
    tracks: [
      {
        name: 'General',
        banner: null,
        events: [
          {
            title: 'Campfire',
            time: '7:00 PM',
            day: 'Sunday',
            location: 'Campfire Pit',
            description: 'Opening campfire',
          },
        ],
      },
    ],
  }),
}));

vi.mock('../src/flows/step2-time.js', () => ({
  step2TimeFlow: vi.fn().mockResolvedValue({
    tracks: [
      {
        name: 'General',
        banner: null,
        events: [
          {
            title: 'Campfire',
            startTime: '2099-06-14T19:00:00-07:00',
            endTime: '2099-06-14T20:00:00-07:00',
            location: 'Campfire Pit',
            description: 'Opening campfire',
          },
        ],
      },
    ],
  }),
}));

vi.mock('../src/flows/step3-location.js', () => ({
  step3LocationFlow: vi.fn().mockResolvedValue({
    tracks: [
      {
        name: 'General',
        banner: null,
        events: [
          {
            title: 'Campfire',
            startTime: '2099-06-14T19:00:00-07:00',
            endTime: '2099-06-14T20:00:00-07:00',
            location: '[Campfire Pit](maplocation://testcamp/campfire_pit)',
            description: 'Opening campfire',
          },
        ],
      },
    ],
  }),
}));

vi.mock('../src/flows/step4-postprocess.js', () => ({
  step4PostProcessFlow: vi.fn().mockResolvedValue({
    tracks: [
      {
        name: 'General',
        banner: null,
        events: [
          {
            id: 'mock_event_id_123',
            startTime: '2099-06-14T19:00:00-07:00',
            endTime: '2099-06-14T20:00:00-07:00',
            title: 'Campfire',
            location: '[Campfire Pit](maplocation://testcamp/campfire_pit)',
            description: 'Opening campfire',
          },
        ],
      },
    ],
  }),
}));

vi.mock('../src/flows/step5-evaluate.js', () => ({
  step5EvaluateFlow: mockStep5EvaluateFlow,
}));

import { processPdf } from '../src/index.js';

describe('Pipeline Schedule JSON & Manifest Persistence', () => {
  const testYear = 2099;
  const testCamp = 'testcamp';
  const testWeekStr = 'week_01';
  const dummyPdfPath = `schedules/${testYear}/${testCamp}/${testWeekStr}.pdf`;
  const expectedJsonPath = path.resolve(process.cwd(), `schedules/${testYear}/${testCamp}/${testWeekStr}.json`);
  const manifestPath = path.resolve(process.cwd(), 'schedules/manifest.json');
  const lastRunPath = path.resolve(process.cwd(), '.tmp/processpdf_lastrun.json');

  beforeEach(() => {
    mockFsState.writtenFiles = {};
    mockStep5EvaluateFlow.mockReset();
  });

  test('persists schedule JSON and updates manifest even when Step 5 audit fails', async () => {
    mockStep5EvaluateFlow.mockResolvedValueOnce({
      score: 2,
      passed: false,
      findings: [
        {
          severity: 'critical',
          message: 'Critical error in event parsing during audit test',
        },
      ],
    });

    const result = await processPdf(dummyPdfPath, false);

    // 1. Process result should be false (indicating audit failure)
    expect(result).toBe(false);

    // 2. Schedule JSON MUST be written to disk with Step 4 data
    expect(mockFsState.writtenFiles[expectedJsonPath]).toBeDefined();
    const writtenJson = JSON.parse(mockFsState.writtenFiles[expectedJsonPath]);
    expect(writtenJson.tracks).toBeDefined();
    expect(writtenJson.tracks[0].name).toBe('General');
    expect(writtenJson.tracks[0].events[0].title).toBe('Campfire');

    // 3. Manifest MUST be updated with the schedule and version hash
    expect(mockFsState.writtenFiles[manifestPath]).toBeDefined();
    const manifest = JSON.parse(mockFsState.writtenFiles[manifestPath]);
    const entry = manifest.schedules.find(
      (s: any) => s.year === testYear && s.camp === testCamp && s.week === 1
    );
    expect(entry).toBeDefined();
    expect(entry.file).toBe(`${testYear}/${testCamp}/${testWeekStr}.json`);
    expect(entry.version).toBeDefined();
    expect(typeof entry.version).toBe('string');
    expect(entry.version.length).toBe(8);

    // 4. Last run status must reflect the failed audit
    expect(mockFsState.writtenFiles[lastRunPath]).toBeDefined();
    const lastRun = JSON.parse(mockFsState.writtenFiles[lastRunPath]);
    expect(lastRun.success).toBe(false);
    expect(lastRun.evalScore).toBe(2);
    expect(lastRun.evalPassed).toBe(false);
  });

  test('persists schedule JSON and updates manifest when Step 5 audit passes', async () => {
    mockStep5EvaluateFlow.mockResolvedValueOnce({
      score: 5,
      passed: true,
      findings: [],
    });

    const result = await processPdf(dummyPdfPath, false);

    // 1. Process result should be true
    expect(result).toBe(true);

    // 2. Schedule JSON MUST be written to disk
    expect(mockFsState.writtenFiles[expectedJsonPath]).toBeDefined();

    // 3. Manifest MUST be updated
    expect(mockFsState.writtenFiles[manifestPath]).toBeDefined();

    // 4. Last run status must reflect success
    expect(mockFsState.writtenFiles[lastRunPath]).toBeDefined();
    const lastRun = JSON.parse(mockFsState.writtenFiles[lastRunPath]);
    expect(lastRun.success).toBe(true);
    expect(lastRun.evalScore).toBe(5);
    expect(lastRun.evalPassed).toBe(true);
  });
});
