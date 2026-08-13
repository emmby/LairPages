import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

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

// Mock step 5
const mockStep5EvaluateFlow = vi.fn();
vi.mock('../src/flows/step5-evaluate.js', () => ({
  step5EvaluateFlow: (...args: any[]) => mockStep5EvaluateFlow(...args),
}));

import { processPdf } from '../src/index.js';

describe('Pipeline Schedule JSON & Manifest Persistence', () => {
  const testYear = 2099;
  const testCamp = 'testcamp';
  const testWeekStr = 'week_01';
  const testPdfDir = path.resolve(process.cwd(), `schedules/${testYear}/${testCamp}`);
  const testPdfPath = path.join(testPdfDir, `${testWeekStr}.pdf`);
  const testJsonPath = path.join(testPdfDir, `${testWeekStr}.json`);
  const manifestPath = path.resolve(process.cwd(), 'schedules/manifest.json');
  let originalManifestContent: string | null = null;

  beforeEach(() => {
    // Create test PDF dummy file
    fs.mkdirSync(testPdfDir, { recursive: true });
    fs.writeFileSync(testPdfPath, 'dummy pdf content', 'utf-8');

    // Backup manifest
    if (fs.existsSync(manifestPath)) {
      originalManifestContent = fs.readFileSync(manifestPath, 'utf-8');
    }

    // Clean up any pre-existing test JSON output
    if (fs.existsSync(testJsonPath)) {
      fs.unlinkSync(testJsonPath);
    }
  });

  afterEach(() => {
    // Restore manifest
    if (originalManifestContent !== null) {
      fs.writeFileSync(manifestPath, originalManifestContent, 'utf-8');
    }

    // Clean up test files and directories
    if (fs.existsSync(testJsonPath)) {
      fs.unlinkSync(testJsonPath);
    }
    if (fs.existsSync(testPdfPath)) {
      fs.unlinkSync(testPdfPath);
    }
    if (fs.existsSync(testPdfDir)) {
      try {
        fs.rmdirSync(testPdfDir);
        fs.rmdirSync(path.dirname(testPdfDir));
      } catch (e) {
        // Ignore if not empty
      }
    }
    vi.clearAllMocks();
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

    const result = await processPdf(`schedules/${testYear}/${testCamp}/${testWeekStr}.pdf`, false);

    // 1. Process result should be false (indicating audit failure)
    expect(result).toBe(false);

    // 2. Schedule JSON MUST be written to disk
    expect(fs.existsSync(testJsonPath), `Expected schedule JSON to exist at ${testJsonPath}`).toBe(true);
    const writtenJson = JSON.parse(fs.readFileSync(testJsonPath, 'utf-8'));
    expect(writtenJson.tracks).toBeDefined();
    expect(writtenJson.tracks[0].name).toBe('General');
    expect(writtenJson.tracks[0].events[0].title).toBe('Campfire');

    // 3. Manifest MUST be updated with the schedule and version hash
    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf-8'));
    const entry = manifest.schedules.find(
      (s: any) => s.year === testYear && s.camp === testCamp && s.week === 1
    );
    expect(entry).toBeDefined();
    expect(entry.file).toBe(`${testYear}/${testCamp}/${testWeekStr}.json`);
    expect(entry.version).toBeDefined();
    expect(typeof entry.version).toBe('string');
    expect(entry.version.length).toBe(8);

    // 4. Last run status must reflect the failed audit
    const lastRunPath = path.resolve(process.cwd(), '.tmp/processpdf_lastrun.json');
    expect(fs.existsSync(lastRunPath)).toBe(true);
    const lastRun = JSON.parse(fs.readFileSync(lastRunPath, 'utf-8'));
    expect(lastRun.success).toBe(false);
    expect(lastRun.evalScore).toBe(2);
    expect(lastRun.evalPassed).toBe(false);
  });
});
