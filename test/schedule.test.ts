import { describe, test, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

// Zod schemas for validation
import { z } from 'zod';

const EventSchema = z.object({
  id: z.string(),
  startTime: z.string(),
  endTime: z.string().nullable().optional(),
  title: z.string(),
  location: z.string().nullable().optional(),
  description: z.string().nullable().optional(),
});

const TrackSchema = z.object({
  name: z.string(),
  banner: z.string().nullable().optional(),
  events: z.array(EventSchema),
});

const ScheduleDataSchema = z.object({
  tracks: z.array(TrackSchema),
});

type EventType = z.infer<typeof EventSchema>;

describe('Schedule Datetime & Schema Tests', () => {
  const scheduleDir = path.resolve(process.cwd(), 'schedules');
  const baseLairDir = process.env.LAIR_DIR || (() => {
    const standardSibling = path.resolve(process.cwd(), '../Lair');
    if (fs.existsSync(standardSibling)) {
      return standardSibling;
    }
    const currentBranchName = path.basename(process.cwd());
    return path.resolve(process.cwd(), `../../Lair/${currentBranchName}`);
  })();
  const mapsDir = path.resolve(baseLairDir, 'assets/maps');


  if (!fs.existsSync(mapsDir)) {
    throw new Error(
      `Sibling Lair repository map assets directory does not exist at: ${mapsDir}. ` +
      `Ensure the Lair repository is checked out adjacent to LairPages, or set the LAIR_DIR environment variable.`
    );
  }

  // Read all valid location IDs from Lair maps
  const validLocationIds = new Set<string>();
  const mapFiles = fs.readdirSync(mapsDir);
  for (const filename of mapFiles) {
    if (filename.startsWith('locations_') && filename.endsWith('.json')) {
      const campName = filename.substring(10, filename.length - 5);
      const content = fs.readFileSync(path.join(mapsDir, filename), 'utf-8');
      const data = JSON.parse(content);
      const locations = data.locations || [];
      for (const loc of locations) {
        if (loc.id) {
          validLocationIds.add(`${campName}/${loc.id}`);
        }
      }
    }
  }

  // Locate all json schedule files, ignoring manifest.json
  const files: string[] = [];
  function getJsonFiles(dir: string) {
    const list = fs.readdirSync(dir);
    for (const file of list) {
      const filepath = path.join(dir, file);
      const stat = fs.statSync(filepath);
      if (stat.isDirectory()) {
        getJsonFiles(filepath);
      } else if (filepath.endsWith('.json') && !filepath.endsWith('manifest.json')) {
        files.push(filepath);
      }
    }
  }

  if (fs.existsSync(scheduleDir)) {
    getJsonFiles(scheduleDir);
  }

  const linkLabelRegExp = /\[([^\]]+)\]\(maplocation:\/\//;

  for (const file of files) {
    const relativePath = path.relative(process.cwd(), file);

    test(`File: ${relativePath} parses correctly and has valid offsets`, () => {
      const content = fs.readFileSync(file, 'utf-8');
      const parsed = JSON.parse(content);
      
      // 1. Verify it parses successfully into the schema
      const result = ScheduleDataSchema.safeParse(parsed);
      expect(result.success, `Schema validation failed for ${relativePath}: ${JSON.stringify(result.error)}`).toBe(true);

      const schedule = result.data!;
      expect(schedule.tracks.length).toBeGreaterThan(0);

      // Find the earliest event start time to establish the week's boundary
      let earliestTime: Date | null = null;
      for (const track of schedule.tracks) {
        for (const event of track.events) {
          const t = new Date(event.startTime);
          if (!earliestTime || t.getTime() < earliestTime.getTime()) {
            earliestTime = t;
          }
        }
      }

      let weekStart: Date | null = null;
      let weekEnd: Date | null = null;
      if (earliestTime) {
        // Check-in is Saturday. Set start bounds to Saturday 00:00:00 UTC
        weekStart = new Date(Date.UTC(earliestTime.getUTCFullYear(), earliestTime.getUTCMonth(), earliestTime.getUTCDate()));
        // And end bounds to Saturday 24:00:00 UTC of the following week (8 days later, exclusive)
        weekEnd = new Date(weekStart.getTime() + 8 * 24 * 60 * 60 * 1000);
      }

      const seenIds = new Set<string>();
      const seenTitleTimes = new Set<string>();

      for (const track of schedule.tracks) {
        expect(track.name).not.toBe('');

        let previousTime: Date | null = null;
        for (const event of track.events) {
          const currentTime = new Date(event.startTime);

          // A. Date Range Boundary Validation
          if (weekStart && weekEnd) {
            const currentMs = currentTime.getTime();
            const startMs = weekStart.getTime();
            const endMs = weekEnd.getTime();
            expect(
              currentMs >= startMs && currentMs < endMs,
              `Event "${event.title}" (time: ${event.startTime}) falls outside the week boundaries (${weekStart.toISOString()} to ${weekEnd.toISOString()}).`
            ).toBe(true);
          }

          // B. Chronological Order Validation
          if (previousTime) {
            expect(
              currentTime.getTime() >= previousTime.getTime(),
              `Event "${event.title}" (startTime: ${event.startTime}) is out of chronological order in track "${track.name}".`
            ).toBe(true);
          }
          previousTime = currentTime;

          // C. Temporal Logic Validation
          if (event.endTime) {
            const endTime = new Date(event.endTime);
            expect(
              endTime.getTime() > currentTime.getTime(),
              `Event "${event.title}" (ID: ${event.id}) has endTime equal to or before startTime.`
            ).toBe(true);

            const durationHrs = (endTime.getTime() - currentTime.getTime()) / (1000 * 60 * 60);
            expect(
              durationHrs <= 24,
              `Event "${event.title}" (ID: ${event.id}) has an implausibly long duration (${durationHrs} hours).`
            ).toBe(true);
          }

          const isAllDay = !event.startTime.includes('T');
          if (!isAllDay) {
            // Check time bounds for non-all-day events
            // Extract hour/minute parts from ISO string (e.g. 2026-06-20T15:00:00-07:00)
            const match = event.startTime.match(/T(\d{2}):(\d{2})/);
            if (match) {
              const startHour = parseInt(match[1], 10);
              expect(
                startHour >= 6,
                `Event "${event.title}" (ID: ${event.id}) starts before 6:00 AM (at ${event.startTime}).`
              ).toBe(true);
            }

            if (event.endTime) {
              const endMatch = event.endTime.match(/T(\d{2}):(\d{2}):(\d{2})/);
              if (endMatch) {
                const endHour = parseInt(endMatch[1], 10);
                const endMinute = parseInt(endMatch[2], 10);
                const endSecond = parseInt(endMatch[3], 10);
                if (endHour >= 1 && endHour < 6) {
                  expect(
                    endHour === 1 && endMinute === 0 && endSecond === 0,
                    `Event "${event.title}" (ID: ${event.id}) ends after 1:00 AM (at ${event.endTime}).`
                  ).toBe(true);
                }
              }
            }
          }

          // D. Duplicate Event Prevention
          expect(
            seenIds.has(event.id),
            `Duplicate event ID "${event.id}" found in track "${track.name}".`
          ).toBe(false);
          seenIds.add(event.id);

          const uniqueKey = `${track.name}_${event.title}_${event.startTime}`;
          expect(
            seenTitleTimes.has(uniqueKey),
            `Duplicate event "${event.title}" at time ${event.startTime} found in track "${track.name}".`
          ).toBe(false);
          seenTitleTimes.add(uniqueKey);

          // E. Text Cleanliness & Formatting Checks
          expect(event.title.trim()).toBe(event.title);
          expect(event.title.includes('\n')).toBe(false);

          // F. Verify timezone offset is PDT (-07:00)
          if (!isAllDay) {
            expect(
              event.startTime.endsWith('-07:00'),
              `Event "${event.title}" (ID: ${event.id}) has invalid startTime offset.`
            ).toBe(true);
          }

          if (event.endTime) {
            expect(
              event.endTime.endsWith('-07:00'),
              `Event "${event.title}" (ID: ${event.id}) has invalid endTime offset.`
            ).toBe(true);
          }

          // G. Location Markdown Link Validation
          if (event.location) {
            const linkRegExp = /maplocation:\/\/([^/)]+)\/([^)]+)/g;
            let match;
            while ((match = linkRegExp.exec(event.location)) !== null) {
              const campId = match[1];
              const locationId = match[2];
              const fullId = `${campId}/${locationId}`;
              expect(
                validLocationIds.has(fullId),
                `Event "${event.title}" contains link to invalid location ID "${fullId}" in location string "${event.location}".`
              ).toBe(true);
            }
          }

          // H. Location Casing Validation
          if (event.location && event.location.length > 0) {
            let firstCharStr = event.location;
            if (firstCharStr.startsWith('[')) {
              firstCharStr = firstCharStr.substring(1);
            }
            if (firstCharStr.length > 0) {
              const firstChar = firstCharStr[0];
              expect(
                firstChar === firstChar.toUpperCase(),
                `Event "${event.title}" location string "${event.location}" must start with an uppercase letter.`
              ).toBe(true);
            }

            // Ensure all maplocation markdown link labels are capitalized
            const labelMatches = event.location.matchAll(/\[([^\]]+)\]\(maplocation:\/\//g);
            for (const match of labelMatches) {
              const label = match[1] || '';
              if (label.length > 0) {
                const firstChar = label[0];
                expect(
                  firstChar === firstChar.toUpperCase(),
                  `Event "${event.title}" markdown link label "${label}" in location string must start with an uppercase letter.`
                ).toBe(true);
              }
            }
          }

          // Ensure markdown links in description are also properly capitalized
          if (event.description && event.description.length > 0) {
            const labelMatches = event.description.matchAll(/\[([^\]]+)\]\(maplocation:\/\//g);
            for (const match of labelMatches) {
              const label = match[1] || '';
              if (label.length > 0) {
                const firstChar = label[0];
                expect(
                  firstChar === firstChar.toUpperCase(),
                  `Event "${event.title}" markdown link label "${label}" in description must start with an uppercase letter.`
                ).toBe(true);
              }
            }
          }
        }
      }
    });
  }
});
