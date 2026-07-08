import * as crypto from 'crypto';
import { z } from 'zod';
import { ai } from '../lib/genkit.js';
import { RawGridSchema } from '../schemas/raw-grid.js';
import { Step3OutputSchema } from '../schemas/located-events.js';
import { titleCase } from 'title-case';
import { FinalScheduleSchema, FinalTrack, FinalEvent } from '../schemas/schedule.js';

export const Step4InputSchema = z.object({
  step0: RawGridSchema,
  step3: Step3OutputSchema,
});

const DNS_NAMESPACE_BYTES = Buffer.from('6ba7b8109dad11d180b400c04fd430c8', 'hex');

export function generateUUIDv5(name: string): string {
  const hash = crypto.createHash('sha1');
  hash.update(DNS_NAMESPACE_BYTES);
  hash.update(name, 'utf-8');
  const buffer = hash.digest();

  // Set version to 5 (0x50) in octet 6
  buffer[6] = (buffer[6] & 0x0f) | 0x50;
  // Set variant to RFC 4122 (0x80) in octet 8
  buffer[8] = (buffer[8] & 0x3f) | 0x80;

  const hex = buffer.toString('hex');
  return `${hex.substring(0, 8)}-${hex.substring(8, 12)}-${hex.substring(12, 16)}-${hex.substring(16, 20)}-${hex.substring(20, 32)}`;
}

function cleanLocationLink(match: string, label: string, target: string): string {
  return `[${titleCase(label.toLowerCase())}](${target})`;
}

export function cleanLocation(loc: string | null | undefined): string | null {
  if (!loc) return null;
  
  // 1. Capitalize markdown link labels (e.g. [pool](...) -> [Pool](...))
  let cleaned = loc.replace(/\[([^\]]+)\]\((maplocation:\/\/[^)]+)\)/g, cleanLocationLink);
  
  // 2. Ensure first letter of the location is capitalized
  if (cleaned.length > 0) {
    if (cleaned.startsWith('[')) {
      if (cleaned.length > 1) {
        cleaned = '[' + cleaned[1].toUpperCase() + cleaned.substring(2);
      }
    } else {
      cleaned = cleaned[0].toUpperCase() + cleaned.substring(1);
    }
  }
  return cleaned;
}

export function cleanDescription(desc: string | null | undefined): string | null {
  if (!desc) return null;
  
  // 1. Programmatically escape all literal markdown syntax characters
  let processed = desc
    .replace(/\*/g, '\\*')
    .replace(/`/g, '\\`');

  // 2. Convert HTML tags to proper Markdown
  processed = processed
    .replace(/<b\b[^>]*>([\s\S]*?)<\/b>/gi, '**$1**')
    .replace(/<strong\b[^>]*>([\s\S]*?)<\/strong>/gi, '**$1**')
    .replace(/<i\b[^>]*>([\s\S]*?)<\/i>/gi, '_$1_')
    .replace(/<em\b[^>]*>([\s\S]*?)<\/em>/gi, '_$1_');

  // 3. Keep the existing markdown link label cleanup
  return processed.replace(/\[([^\]]+)\]\((maplocation:\/\/[^)]+)\)/g, cleanLocationLink);
}

export const step4PostProcessFlow = ai.defineFlow(
  {
    name: 'step4PostProcess',
    inputSchema: Step4InputSchema,
    outputSchema: FinalScheduleSchema,
  },
  async (input) => {
    const finalTracks = input.step3.tracks.map((step3Track) => {
      // 1. Find matching raw track in step0 to recover banner
      const matchingStep0Track = input.step0.tracks.find(
        (t) => t.name.toLowerCase() === step3Track.trackName.toLowerCase() ||
               (t.name.toLowerCase() === 'all camp activities' && step3Track.trackName.toLowerCase() === 'all-camp activities')
      );
      const banner = matchingStep0Track?.banner || null;

      // 2. Normalize track name casing
      const normalizedTrackName = step3Track.trackName.replace(/\ball[\s-]*camp\b/gi, 'All-camp');

      // 3. Process events
      const processedEvents: FinalEvent[] = step3Track.events.map((event) => {
        // Clean fields
        const cleanedLoc = cleanLocation(event.location);
        const cleanedDesc = cleanDescription(event.description);

        // Generate deterministic, case-insensitive UUIDv5
        const cleanTitleForHash = event.title.toLowerCase().trim();
        const cleanTrackForHash = normalizedTrackName.toLowerCase().trim();
        const hashInput = `${cleanTitleForHash}_${event.startTime}_${cleanTrackForHash}`;
        const eventId = generateUUIDv5(hashInput);

        return {
          id: eventId,
          startTime: event.startTime,
          endTime: event.endTime || null,
          title: event.title,
          location: cleanedLoc,
          description: cleanedDesc,
        };
      });

      // 4. Sort events chronologically (startTime, then title)
      processedEvents.sort((a, b) => {
        const timeDiff = a.startTime.localeCompare(b.startTime);
        if (timeDiff !== 0) return timeDiff;
        return a.title.localeCompare(b.title);
      });

      return {
        name: normalizedTrackName,
        banner: banner,
        events: processedEvents,
      };
    });

    return {
      tracks: finalTracks,
    };
  }
);
