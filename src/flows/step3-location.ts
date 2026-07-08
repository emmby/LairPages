import * as fs from 'fs';
import * as path from 'path';
import { z } from 'zod';
import { ai, runWithRetry } from '../lib/genkit.js';
import { Step2OutputSchema } from '../schemas/timed-events.js';
import { Step3OutputSchema, LocationMappingResultsSchema, LocationMapping } from '../schemas/located-events.js';

export const Step3InputSchema = z.object({
  camp: z.enum(['oski', 'blue', 'gold']),
  tracks: Step2OutputSchema.shape.tracks,
});

function loadMapLocations(mapsDir: string): Array<{ id: string; name: string }> {
  const list: Array<{ id: string; name: string }> = [];
  if (!fs.existsSync(mapsDir)) {
    console.warn(`Warning: Maps directory not found at ${mapsDir}`);
    return list;
  }
  const files = fs.readdirSync(mapsDir);
  files.forEach(filename => {
    if (filename.startsWith('locations_') && filename.endsWith('.json')) {
      const campName = filename.substring(10, filename.length - 5);
      const filepath = path.join(mapsDir, filename);
      try {
        const data = JSON.parse(fs.readFileSync(filepath, 'utf-8'));
        const locations = data.locations || [];
        locations.forEach((loc: any) => {
          if (loc.id && loc.name) {
            list.push({
              id: `${campName}/${loc.id}`,
              name: loc.name,
            });
          }
        });
      } catch (err) {
        console.error(`Error loading maps file ${filename}:`, err);
      }
    }
  });
  return list;
}



function escapeRegExp(string: string) {
  return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function applyMappings(text: string | null | undefined, mapping: Map<string, string>): string | null {
  if (!text) return null;
  let result = text;
  // Sort mapping keys by length descending to match longest matches first
  const sortedKeys = Array.from(mapping.keys()).sort((a, b) => b.length - a.length);
  for (const key of sortedKeys) {
    const val = mapping.get(key);
    if (val && val !== key) {
      const pattern = new RegExp('(\\[[^\\]]+\\]\\([^)]+\\))|(?<!\\w)' + escapeRegExp(key) + '(?!\\w)', 'gi');
      result = result.replace(pattern, (match, link) => {
        if (link) return link;
        return val;
      });
    }
  }
  return result;
}

export const step3LocationFlow = ai.defineFlow(
  {
    name: 'step3Location',
    inputSchema: Step3InputSchema,
    outputSchema: Step3OutputSchema,
  },
  async (input) => {
    // 1. Load map locations from sibling Lair folder
    let mapsDir = path.resolve(process.cwd(), '../Lair/assets/maps');
    if (!fs.existsSync(mapsDir)) {
      mapsDir = path.resolve(process.cwd(), '../../Lair/refactor-pdf-processing-engine/assets/maps');
    }
    console.log(`Loading map locations from: ${mapsDir}`);
    const knownLocations = loadMapLocations(mapsDir);
    console.log(`Loaded ${knownLocations.length} known locations.`);

    // 2. Identify all unique raw locations
    const rawLocations = new Set<string>();
    input.tracks.forEach(track => {
      track.events.forEach(event => {
        if (event.location) {
          // Strip any pre-existing markdown links
          const clean = event.location.replace(/\[([^\]]+)\]\([^)]+\)/g, '$1').trim();
          if (clean) {
            rawLocations.add(clean);
          }
        }
      });
    });

    console.log(`Found ${rawLocations.size} unique raw locations to resolve.`);

    if (rawLocations.size === 0) {
      console.log('No locations to resolve.');
      return { tracks: input.tracks };
    }

    // Load location aliases from JSON file
    const aliasesFilePath = path.resolve(process.cwd(), 'src/lib/location_aliases.json');
    const aliasesData = JSON.parse(fs.readFileSync(aliasesFilePath, 'utf-8'));
    const campAliases = aliasesData[input.camp] || {};

    // 3. Resolve locations via Gemini Step 3 prompt
    const step3Prompt = ai.prompt('step3-location');
    const response = await runWithRetry(() =>
      step3Prompt(
        {
          camp: input.camp,
          aliases: campAliases,
          knownLocations,
          rawLocations: Array.from(rawLocations),
        },
        {
          output: { schema: LocationMappingResultsSchema },
        }
      )
    );

    if (!response.output) {
      throw new Error('Model did not return structured output for location resolution');
    }

    // 4. Build mapping lookup
    const mappingMap = new Map<string, string>();
    response.output.mappings.forEach((mapping: LocationMapping) => {
      if (mapping.mappedLocation) {
        mappingMap.set(mapping.rawLocation.trim().toLowerCase(), mapping.mappedLocation);
        console.log(`  Mapped: "${mapping.rawLocation}" -> "${mapping.mappedLocation}"`);
      } else {
        console.log(`  Unmapped: "${mapping.rawLocation}"`);
      }
    });

    // 5. Re-assemble tracks, mapping both location and description fields
    const mappedTracks = input.tracks.map(track => {
      const mappedEvents = track.events.map(event => {
        // Map the location field
        let mappedLoc = event.location;
        if (event.location) {
          const cleanLoc = event.location.replace(/\[([^\]]+)\]\([^)]+\)/g, '$1').trim();
          const mappedVal = mappingMap.get(cleanLoc.toLowerCase());
          if (mappedVal) {
            mappedLoc = mappedVal;
          }
        }

        // Map any location references in description
        const mappedDesc = applyMappings(event.description, mappingMap);

        return {
          startTime: event.startTime,
          endTime: event.endTime,
          title: event.title,
          location: mappedLoc,
          description: mappedDesc,
        };
      });

      return {
        trackName: track.trackName,
        events: mappedEvents,
      };
    });

    return {
      tracks: mappedTracks,
    };
  }
);
