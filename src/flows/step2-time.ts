import { z } from 'zod';
import { ai } from '../lib/genkit.js';
import { Step1OutputSchema } from '../schemas/events.js';
import { Step2OutputSchema, TimeResolutionResultsSchema } from '../schemas/timed-events.js';

export const Step2InputSchema = z.object({
  startDate: z.string(),
  tracks: Step1OutputSchema.shape.tracks,
});

function sanitizeTimestamp(ts: string | null | undefined): string | null {
  if (!ts) return null;
  let s = ts.trim();
  // Ensure uppercase 'T'
  s = s.replace(/t/i, 'T');
  // If it's missing seconds (e.g. 2026-06-20T15:00-07:00), insert :00
  const shortFormat = /^(\d{4}-\d{2}-\d{2}THH:mm)(-\d{2}:\d{2})$/i;
  const match = s.match(/^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2})(-\d{2}:\d{2})$/);
  if (match) {
    s = `${match[1]}:00${match[2]}`;
  }
  return s;
}

export const step2TimeFlow = ai.defineFlow(
  {
    name: 'step2Time',
    inputSchema: Step2InputSchema,
    outputSchema: Step2OutputSchema,
  },
  async (input) => {
    // 1. Flatten events and assign unique sequential IDs
    const flatEvents: any[] = [];
    const eventMap = new Map<number, { trackIdx: number; eventIdx: number }>();
    
    let uniqueId = 0;
    input.tracks.forEach((track, trackIdx) => {
      track.events.forEach((event, eventIdx) => {
        flatEvents.push({
          uniqueId,
          rawDay: event.rawDay,
          rawTime: event.rawTime,
          title: event.title,
        });
        eventMap.set(uniqueId, { trackIdx, eventIdx });
        uniqueId++;
      });
    });

    console.log(`Assigned sequential IDs to ${flatEvents.length} events.`);

    // 2. Batch events (40 per batch)
    const batchSize = 40;
    const batches = [];
    for (let i = 0; i < flatEvents.length; i += batchSize) {
      batches.push(flatEvents.slice(i, i + batchSize));
    }

    console.log(`Resolving times in ${batches.length} concurrent batches...`);

    const step2Prompt = ai.prompt('step2-time');
    const promises = batches.map(async (batch, idx) => {
      console.log(`[Time Batch ${idx + 1}/${batches.length}] Sending ${batch.length} events.`);
      const response = await step2Prompt(
        {
          startDate: input.startDate,
          events: batch,
        },
        {
          output: { schema: TimeResolutionResultsSchema },
        }
      );

      if (!response.output) {
        throw new Error(`Model failed to return output for time batch ${idx + 1}`);
      }

      console.log(`[Time Batch ${idx + 1}/${batches.length}] Resolved ${response.output.resolutions.length} timestamps.`);
      return response.output.resolutions;
    });

    const results = await Promise.all(promises);
    const allResolutions = results.flat();

    // Create a lookup map of resolved timestamps
    const resolutionMap = new Map<number, { startTime: string; endTime: string | null }>();
    allResolutions.forEach(res => {
      resolutionMap.set(res.uniqueId, {
        startTime: sanitizeTimestamp(res.startTime)!,
        endTime: sanitizeTimestamp(res.endTime),
      });
    });

    // 3. Re-assemble final structure, replacing rawDay/rawTime with resolved timestamps
    const outputTracks = input.tracks.map((track, trackIdx) => {
      const timedEvents = track.events.map((event, eventIdx) => {
        // Find corresponding unique ID
        let foundId: number | null = null;
        for (const [uid, loc] of eventMap.entries()) {
          if (loc.trackIdx === trackIdx && loc.eventIdx === eventIdx) {
            foundId = uid;
            break;
          }
        }

        if (foundId === null || !resolutionMap.has(foundId)) {
          throw new Error(`Missing timestamp resolution for track "${track.trackName}" event index ${eventIdx} ("${event.title}")`);
        }

        const resolved = resolutionMap.get(foundId)!;
        return {
          startTime: resolved.startTime,
          endTime: resolved.endTime,
          title: event.title,
          location: event.location,
          description: event.description,
        };
      });

      return {
        trackName: track.trackName,
        events: timedEvents,
      };
    });

    return {
      tracks: outputTracks,
    };
  }
);
