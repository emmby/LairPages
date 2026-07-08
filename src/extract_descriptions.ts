import * as fs from 'fs';
import * as path from 'path';

function main() {
  const batchDir = path.resolve(process.cwd(), '.tmp/batch_step0');
  if (!fs.existsSync(batchDir)) {
    console.error(`Batch step0 directory not found at: ${batchDir}`);
    return;
  }

  const files = fs.readdirSync(batchDir).filter(f => f.endsWith('_step0.json'));
  const allDescriptions = new Set<string>();

  files.forEach(filename => {
    const filepath = path.join(batchDir, filename);
    try {
      const data = JSON.parse(fs.readFileSync(filepath, 'utf-8'));
      const tracks = data.tracks || [];
      tracks.forEach((track: any) => {
        const cells = track.cells || [];
        cells.forEach((cell: any) => {
          if (cell.colC) {
            allDescriptions.add(cell.colC.trim());
          }
        });
      });
    } catch (err) {
      console.error(`Error reading ${filename}:`, err);
    }
  });

  console.log(`Extracted ${allDescriptions.size} unique event descriptions.`);

  // Write all unique descriptions to a scratch file
  const scratchDir = path.resolve(process.cwd(), '.tmp/scratch');
  fs.mkdirSync(scratchDir, { recursive: true });
  const rawOutPath = path.join(scratchDir, 'unique_descriptions.txt');
  fs.writeFileSync(rawOutPath, Array.from(allDescriptions).join('\n'), 'utf-8');
  console.log(`Saved all unique descriptions to: ${rawOutPath}`);

  // Now, extract potential location phrases (words following prepositions)
  const candidates = new Set<string>();
  const regexes = [
    /at\s+the\s+([A-Z][a-zA-Z\s’'’-]{3,30})(?=\b|\.|\,)/g,
    /in\s+the\s+([A-Z][a-zA-Z\s’'’-]{3,30})(?=\b|\.|\,)/g,
    /near\s+the\s+([A-Z][a-zA-Z\s’'’-]{3,30})(?=\b|\.|\,)/g,
    /by\s+the\s+([A-Z][a-zA-Z\s’'’-]{3,30})(?=\b|\.|\,)/g,
    /meet\s+at\s+([A-Z][a-zA-Z\s’'’-]{3,30})(?=\b|\.|\,)/g,
    /to\s+the\s+([A-Z][a-zA-Z\s’'’-]{3,30})(?=\b|\.|\,)/g,
  ];

  allDescriptions.forEach(desc => {
    regexes.forEach(regex => {
      let match;
      while ((match = regex.exec(desc)) !== null) {
        let loc = match[1].trim();
        // Stop at sentence boundaries or punctuation/conjunctions
        loc = loc.split(/\s+(?:and|or|for|with|to|at|in|on|by|is|are|was|were|will|during|starts?|ends?)\b/)[0];
        loc = loc.replace(/[.,\/#!$%\^&\*;:{}=\-_`~()]/g, '').trim();
        if (loc.length > 2 && loc[0] === loc[0].toUpperCase()) {
          candidates.add(loc);
        }
      }
    });
  });

  const candidatesOutPath = path.join(scratchDir, 'candidate_locations.txt');
  fs.writeFileSync(candidatesOutPath, Array.from(candidates).sort().join('\n'), 'utf-8');
  console.log(`Saved candidate location strings to: ${candidatesOutPath}`);
}

main();
