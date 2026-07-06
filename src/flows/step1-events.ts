import { z } from 'zod';
import { titleCase } from 'title-case';
import { ai } from '../lib/genkit.js';
import { RawGridSchema } from '../schemas/raw-grid.js';
import { Step1OutputSchema, Step1BatchOutputSchema } from '../schemas/events.js';

export const step1EventsFlow = ai.defineFlow(
  {
    name: 'step1Events',
    inputSchema: RawGridSchema,
    outputSchema: Step1OutputSchema,
  },
  async (rawGrid) => {
    // Programmatically convert track names and colA category/day labels to Title Case
    const sanitizedTracks = rawGrid.tracks.map(track => ({
      ...track,
      name: titleCase(track.name.toLowerCase()),
      cells: track.cells.map(cell => ({
        ...cell,
        colA: titleCase(cell.colA.toLowerCase()),
        colB: cell.colB,
        colC: cell.colC,
      }))
    }));

    // Greedy bin-packing to balance batches by cell count (max 3 tracks per batch)
    const sortedTracks = [...sanitizedTracks].sort(
      (a, b) => b.cells.length - a.cells.length
    );

    const batches: any[][] = [];
    for (const track of sortedTracks) {
      let bestBatch = null;
      let minCellCount = Infinity;

      for (const batch of batches) {
        if (batch.length < 3) {
          const batchCellCount = batch.reduce((sum, t) => sum + t.cells.length, 0);
          if (batchCellCount < minCellCount) {
            minCellCount = batchCellCount;
            bestBatch = batch;
          }
        }
      }

      if (bestBatch) {
        bestBatch.push(track);
      } else {
        batches.push([track]);
      }
    }

    console.log(`Processing ${rawGrid.tracks.length} tracks in ${batches.length} balanced concurrent batches...`);
    
    const step1Prompt = ai.prompt('step1-events');
    const promises = batches.map(async (batch, idx) => {
      const batchNames = batch.map(t => t.name).join(', ');
      console.log(`[Batch ${idx + 1}/${batches.length}] Sending tracks: ${batchNames}`);
      
      const response = await step1Prompt(
        { tracks: batch },
        {
          output: { schema: Step1BatchOutputSchema },
        }
      );

      if (!response.output) {
        throw new Error(`Model failed to return output for batch ${idx + 1}: ${batchNames}`);
      }

      console.log(`[Batch ${idx + 1}/${batches.length}] Received extraction with ${response.output.tracks.length} tracks.`);
      return response.output.tracks;
    });

    const results = await Promise.all(promises);
    const flattenedTracks = results.flat();

    // Restore original track order from Step 0 (using the same Title Case formatting)
    const originalOrder = rawGrid.tracks.map(t => titleCase(t.name.toLowerCase()));
    flattenedTracks.sort((a, b) => {
      const indexA = originalOrder.indexOf(a.trackName);
      const indexB = originalOrder.indexOf(b.trackName);
      return indexA - indexB;
    });

    return {
      tracks: flattenedTracks,
    };
  }
);
