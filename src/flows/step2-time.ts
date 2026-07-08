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
  const trimmed = ts.trim();
  const date = new Date(trimmed);
  if (isNaN(date.getTime())) {
    throw new Error(`Invalid timestamp format received from model: "${trimmed}"`);
  }
  // Shift by 7 hours (PDT offset is UTC -7) to obtain local PDT components
  const localTime = new Date(date.getTime() - 7 * 60 * 60 * 1000);
  // localTime.toISOString() yields 'YYYY-MM-DDTHH:mm:ss.sssZ'
  // Slice to 'YYYY-MM-DDTHH:mm:ss' and append the '-07:00' timezone offset
  return localTime.toISOString().substring(0, 19) + '-07:00';
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

    // --- STEP 2 VALIDATIONS ---

    // 1. Input-to-Output Event Count Parity
    const outputEventCount = outputTracks.reduce((acc, t) => acc + t.events.length, 0);
    if (flatEvents.length !== outputEventCount) {
      throw new Error(`Event count mismatch: input has ${flatEvents.length} events, output has ${outputEventCount} events.`);
    }

    // 2. Week Boundary Calculations
    const lowerBoundMs = new Date(`${input.startDate}T00:00:00-07:00`).getTime();
    const upperBoundMs = lowerBoundMs + 8 * 24 * 60 * 60 * 1000; // 8 days total to cover checkout Saturday entirely (including midnight ending)

    const isoRegex = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}-07:00$/;

    outputTracks.forEach(track => {
      track.events.forEach((event, eventIdx) => {
        // Validation 3: Strict ISO-8601 format check
        if (!isoRegex.test(event.startTime)) {
          throw new Error(`Track "${track.trackName}" event index ${eventIdx} ("${event.title}"): startTime "${event.startTime}" is not in YYYY-MM-DDTHH:mm:ss-07:00 format.`);
        }
        if (event.endTime && !isoRegex.test(event.endTime)) {
          throw new Error(`Track "${track.trackName}" event index ${eventIdx} ("${event.title}"): endTime "${event.endTime}" is not in YYYY-MM-DDTHH:mm:ss-07:00 format.`);
        }

        const startMs = new Date(event.startTime).getTime();
        const endMs = event.endTime ? new Date(event.endTime).getTime() : null;

        // Validation 4: Week Boundary Date Range check
        if (startMs < lowerBoundMs || startMs > upperBoundMs) {
          throw new Error(`Track "${track.trackName}" event index ${eventIdx} ("${event.title}"): startTime "${event.startTime}" falls outside week boundaries [${input.startDate} to ${new Date(upperBoundMs).toISOString().split('T')[0]}].`);
        }
        if (endMs && (endMs < lowerBoundMs || endMs > upperBoundMs)) {
          throw new Error(`Track "${track.trackName}" event index ${eventIdx} ("${event.title}"): endTime "${event.endTime}" falls outside week boundaries [${input.startDate} to ${new Date(upperBoundMs).toISOString().split('T')[0]}].`);
        }

        // Validation 5: Temporal Logical Integrity (startTime < endTime)
        if (endMs && startMs >= endMs) {
          throw new Error(`Track "${track.trackName}" event index ${eventIdx} ("${event.title}"): startTime "${event.startTime}" is not before endTime "${event.endTime}".`);
        }
      });
    });

    return {
      tracks: outputTracks,
    };
  }
);
