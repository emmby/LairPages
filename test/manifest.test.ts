import { describe, test, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import { z } from 'zod';

const ManifestCampSchema = z.object({
  id: z.string(),
  name: z.string(),
});

const ManifestScheduleSchema = z.object({
  year: z.number(),
  camp: z.string(),
  week: z.number(),
  file: z.string(),
  version: z.string(),
});

const ManifestSchema = z.object({
  camps: z.array(ManifestCampSchema),
  schedules: z.array(ManifestScheduleSchema),
});

describe('Manifest Validation Tests', () => {
  test('manifest.json is valid and referenced schedules exist', () => {
    const manifestPath = path.resolve(process.cwd(), 'schedules/manifest.json');
    expect(fs.existsSync(manifestPath), `manifest.json does not exist at ${manifestPath}`).toBe(true);

    const content = fs.readFileSync(manifestPath, 'utf-8');
    const parsed = JSON.parse(content);
    
    const result = ManifestSchema.safeParse(parsed);
    expect(result.success, `Manifest validation failed: ${JSON.stringify(result.error)}`).toBe(true);

    const manifest = result.data!;
    expect(manifest.camps.length).toBeGreaterThan(0);
    expect(manifest.schedules.length).toBeGreaterThan(0);

    for (const entry of manifest.schedules) {
      const scheduleFilePath = path.resolve(process.cwd(), 'schedules', entry.file);
      expect(
        fs.existsSync(scheduleFilePath),
        `Schedule file "${entry.file}" listed in manifest.json does not exist at ${scheduleFilePath}.`
      ).toBe(true);
    }
  });
});
