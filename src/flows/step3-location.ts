import * as fs from 'fs';
import * as path from 'path';
import { z } from 'zod';
import { ai } from '../lib/genkit.js';
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

function getCampAliasesPrompt(camp: string): string {
  if (camp === 'oski') {
    return `
Aliases:
- 'Stage' or 'Oski Stage' -> 'oski/papa_bear_stage'
- 'Dining Hall' or 'Oski Dining Hall' -> 'oski/lodge'
- 'Lair Lodge' or 'Lodge' -> 'oski/lodge'
- 'Volleyball Court' or 'Oski Volleyball Court' -> 'oski/volleyball_court'
- 'Gaga Pit' -> 'gold/gaga_ball'
- 'Wellness Center' -> 'gold/wellness_center'
- 'Vista Lodge' or 'Vista Lounge' -> 'gold/vista_lodge'
- 'Teen Lodge' -> 'gold/teen_lodge'
- 'Bruised Bears Building' or 'Bruised Bears' -> 'gold/wounded_bears'
- 'Gold Pool' -> 'gold/pool'
- 'Gold Softball Field' or 'Softball Field' -> 'gold/sports_courts'
`;
  } else if (camp === 'blue') {
    return `
Aliases:
- 'Stage' or 'Blue Stage' -> 'blue/stage'
- 'Dining Hall' or 'Blue Dining Hall' -> 'blue/dining_hall'
- 'Lodge' or 'Blue Lodge' -> 'blue/lodge'
- 'Volleyball Court' -> 'blue/sports_courts'
- 'Gaga Pit' -> 'gold/gaga_ball'
- 'Wellness Center' -> 'gold/wellness_center'
- 'Vista Lodge' -> 'gold/vista_lodge'
- 'Teen Lodge' -> 'gold/teen_lodge'
- 'Bruised Bears Building' -> 'gold/wounded_bears'
- 'Gold Pool' -> 'gold/pool'
`;
  } else if (camp === 'gold') {
    return `
Aliases:
- 'Stage' or 'Gold Stage' -> 'gold/stage'
- 'Dining Hall' or 'Gold Dining Hall' -> 'gold/dining_hall'
- 'Lodge' or 'Gold Lodge' -> 'gold/lodge'
- 'Volleyball Court' -> 'gold/sports_courts'
- 'Gaga Pit' -> 'gold/gaga_ball'
- 'Wellness Center' -> 'gold/wellness_center'
- 'Vista Lodge' -> 'gold/vista_lodge'
- 'Teen Lodge' -> 'gold/teen_lodge'
- 'Bruised Bears Building' -> 'gold/wounded_bears'
- 'Gold Pool' -> 'gold/pool'
`;
  }
  return '';
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
      const pattern = new RegExp('(\\[[^\\]]+\\]\\([^)]+\\))|\\b' + escapeRegExp(key) + '\\b', 'gi');
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
    const mapsDir = path.resolve(process.cwd(), '../../Lair/refactor-pdf-processing-engine/assets/maps');
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

    // 3. Resolve locations via Gemini Step 3 prompt
    const step3Prompt = ai.prompt('step3-location');
    const response = await step3Prompt(
      {
        camp: input.camp,
        aliases: getCampAliasesPrompt(input.camp),
        knownLocations,
        rawLocations: Array.from(rawLocations),
      },
      {
        output: { schema: LocationMappingResultsSchema },
      }
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
