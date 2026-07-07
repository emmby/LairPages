import { z } from 'zod';
import * as fs from 'fs';
import * as path from 'path';
import { ai } from '../lib/genkit.js';
import { RawGridSchema, RawGridTrack } from '../schemas/raw-grid.js';

export const step0ExtractFlow = ai.defineFlow(
  {
    name: 'step0Extract',
    inputSchema: z.object({
      pdfPath: z.string(),
    }),
    outputSchema: RawGridSchema,
  },
  async (input) => {
    const resolvedPath = path.resolve(process.cwd(), input.pdfPath);
    if (!fs.existsSync(resolvedPath)) {
      throw new Error(`File not found at: ${resolvedPath}`);
    }

    console.log(`Reading PDF file: ${resolvedPath}`);
    const pdfBuffer = fs.readFileSync(resolvedPath);
    const pdfBase64 = pdfBuffer.toString('base64');
    const pdfUrl = `data:application/pdf;base64,${pdfBase64}`;

    console.log(`Loading step0-extract prompt...`);
    const step0Prompt = ai.prompt('step0-extract');

    console.log(`Executing model call for Step 0...`);
    const response = await step0Prompt(
      { pdfUrl },
      {
        output: { schema: RawGridSchema },
      }
    );

    const parsed = response.output;
    if (!parsed) {
      throw new Error('Model did not return structured output matching RawGridSchema');
    }

    // Programmatically rename "All Camp Activities" to "All-camp Activities" to avoid app filter confusion
    parsed.tracks = parsed.tracks.map((track: RawGridTrack) => {
      if (track.name.toLowerCase() === 'all camp activities') {
        return { ...track, name: 'All-camp Activities' };
      }
      return track;
    });

    // 1. Saturday Start Date Check
    const date = new Date(parsed.metadata.startDate);
    if (isNaN(date.getTime()) || date.getUTCDay() !== 6) {
      throw new Error(`startDate must be a valid Saturday (got ${parsed.metadata.startDate})`);
    }

    // 2. Unique Track Names Check
    const trackNames = parsed.tracks.map((t: RawGridTrack) => t.name);
    const uniqueNames = new Set(trackNames);
    if (uniqueNames.size !== trackNames.length) {
      const duplicates = trackNames.filter((item: string, index: number) => trackNames.indexOf(item) !== index);
      throw new Error(`Duplicate track names found: ${Array.from(new Set(duplicates)).join(', ')}`);
    }

    return parsed;
  }
);
