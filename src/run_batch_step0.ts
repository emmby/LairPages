import { step0ExtractFlow } from './flows/step0-extract.js';
import * as fs from 'fs';
import * as path from 'path';

const pdfs = [
  { camp: 'blue', week: '03', path: 'schedules/2026/blue/week_03.pdf' },
  { camp: 'blue', week: '04', path: 'schedules/2026/blue/week_04.pdf' },
  { camp: 'blue', week: '05', path: 'schedules/2026/blue/week_05.pdf' },
  { camp: 'gold', week: '03', path: 'schedules/2026/gold/week_03.pdf' },
  { camp: 'gold', week: '04', path: 'schedules/2026/gold/week_04.pdf' },
  { camp: 'gold', week: '05', path: 'schedules/2026/gold/week_05.pdf' },
  { camp: 'oski', week: '03', path: 'schedules/2026/oski/week_03.pdf' },
  { camp: 'oski', week: '04', path: 'schedules/2026/oski/week_04.pdf' },
  { camp: 'oski', week: '05', path: 'schedules/2026/oski/week_05.pdf' },
];

async function main() {
  const outDir = path.resolve(process.cwd(), '.tmp/batch_step0');
  fs.mkdirSync(outDir, { recursive: true });

  // If we already have the general week_03_step0.json, copy it to oski_week_03_step0.json to save API calls
  const existingOskiWeek3 = path.resolve(process.cwd(), '.tmp/week_03_step0.json');
  const targetOskiWeek3 = path.join(outDir, 'oski_week_03_step0.json');
  if (fs.existsSync(existingOskiWeek3) && !fs.existsSync(targetOskiWeek3)) {
    fs.copyFileSync(existingOskiWeek3, targetOskiWeek3);
    console.log(`Copied existing Oski Week 3 transcription to batch directory.`);
  }

  for (const pdf of pdfs) {
    const outPath = path.join(outDir, `${pdf.camp}_week_${pdf.week}_step0.json`);
    if (fs.existsSync(outPath)) {
      console.log(`[SKIPPED] Already transcribed: ${pdf.path}`);
      continue;
    }

    console.log(`[RUNNING] Transcribing: ${pdf.path}...`);
    try {
      const result = await step0ExtractFlow({ pdfPath: pdf.path });
      fs.writeFileSync(outPath, JSON.stringify(result, null, 2), 'utf-8');
      console.log(`[SUCCESS] Saved to ${outPath}`);
    } catch (err) {
      console.error(`[ERROR] Failed on ${pdf.path}:`, err);
    }
  }
  console.log('Batch transcription finished!');
}

main().catch(err => {
  console.error('Fatal batch run error:', err);
  process.exit(1);
});
