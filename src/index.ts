import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';
import { step0ExtractFlow } from './flows/step0-extract.js';
import { step1EventsFlow } from './flows/step1-events.js';
import { step2TimeFlow } from './flows/step2-time.js';
import { step3LocationFlow } from './flows/step3-location.js';
import { step4PostProcessFlow } from './flows/step4-postprocess.js';
import { step5EvaluateFlow } from './flows/step5-evaluate.js';

async function processPdf(pdfPathArg: string, useCache: boolean): Promise<boolean> {
  const startTime = Date.now();
  const pdfPath = path.resolve(process.cwd(), pdfPathArg);
  if (!fs.existsSync(pdfPath)) {
    console.error(`PDF file not found at: ${pdfPath}`);
    return false;
  }

  // Parse camp and week from path (e.g. schedules/2026/oski/week_03.pdf)
  const match = pdfPathArg.match(/schedules\/(\d{4})\/([^/]+)\/([^/.]+)\.pdf/);
  if (!match) {
    console.error(`Invalid PDF path format for ${pdfPathArg}. Expected: schedules/<year>/<camp>/<week>.pdf`);
    return false;
  }

  const year = parseInt(match[1], 10);
  const camp = match[2];
  const weekStr = match[3]; // e.g. week_03
  const week = parseInt(weekStr.replace('week_', ''), 10);

  console.log(`\n=============================================`);
  console.log(`Processing: ${camp.toUpperCase()} Year ${year} ${weekStr.toUpperCase()}...`);
  console.log(`=============================================`);

  // Step 0: Transcription / Image Processing
  let step0Result;
  const cachedStep0Path = path.resolve(process.cwd(), `.tmp/batch_step0/${camp}_${weekStr}_step0.json`);
  const localStep0Path = path.resolve(process.cwd(), `.tmp/${weekStr}_step0.json`);

  if (useCache && fs.existsSync(cachedStep0Path)) {
    console.log(`[Step 0] Using cached visual transcription from batch directory...`);
    step0Result = JSON.parse(fs.readFileSync(cachedStep0Path, 'utf-8'));
  } else if (useCache && fs.existsSync(localStep0Path)) {
    console.log(`[Step 0] Using cached visual transcription from local .tmp...`);
    step0Result = JSON.parse(fs.readFileSync(localStep0Path, 'utf-8'));
  } else {
    console.log(`[Step 0] Transcribing PDF pages using Gemini visual grid OCR...`);
    step0Result = await step0ExtractFlow({ pdfPath });
    // Cache it locally
    fs.mkdirSync(path.dirname(localStep0Path), { recursive: true });
    fs.writeFileSync(localStep0Path, JSON.stringify(step0Result, null, 2), 'utf-8');
  }

  // Step 1: Event Extraction
  console.log(`[Step 1] Extracting individual events from transcribed tracks...`);
  const step1Result = await step1EventsFlow(step0Result);

  // Step 2: Time Resolution
  console.log(`[Step 2] Resolving event times to ISO-8601 timestamps...`);
  const step2Result = await step2TimeFlow({
    startDate: step0Result.metadata.startDate,
    tracks: step1Result.tracks,
  });

  // Step 3: Location Mapping
  console.log(`[Step 3] Mapping locations and generating coordinates links...`);
  const step3Result = await step3LocationFlow({
    camp: step0Result.metadata.camp,
    tracks: step2Result.tracks,
  });

  // Step 4: Post-processing
  console.log(`[Step 4] Assembling final schedule JSON structure...`);
  const step4Result = await step4PostProcessFlow({
    step0: step0Result,
    step3: step3Result,
  });

  // Step 5: LLM Evaluation
  console.log(`[Step 5] Running LLM-as-judge audit...`);
  const step5Result = await step5EvaluateFlow({
    step0: step0Result,
    step4: step4Result,
  });

  console.log('\n=============================================');
  console.log('            EVALUATION REPORT               ');
  console.log('=============================================');
  console.log(`Score:  ${step5Result.score}/5`);
  console.log(`Passed: ${step5Result.passed ? '✅ YES' : '❌ NO'}`);
  console.log('---------------------------------------------');
  console.log('Findings:');
  if (step5Result.findings.length === 0) {
    console.log('  No issues or warnings found.');
  } else {
    for (const finding of step5Result.findings) {
      const icon = finding.severity === 'critical' ? '❌' : (finding.severity === 'warning' ? '⚠️' : 'ℹ️');
      const context = finding.locationContext ? ` (${finding.locationContext})` : '';
      console.log(`  ${icon} [${finding.severity.toUpperCase()}]${context}: ${finding.message}`);
    }
  }
  console.log('=============================================\n');

  if (!step5Result.passed) {
    console.error(`Pipeline failed: Audit failed for ${pdfPathArg}! Please review critical issues above.`);
    return false;
  }

  // Write final output file to schedules/2026/<camp>/<week>.json
  const finalOutputPath = path.resolve(process.cwd(), `schedules/${year}/${camp}/${weekStr}.json`);
  fs.mkdirSync(path.dirname(finalOutputPath), { recursive: true });
  const finalJsonStr = JSON.stringify(step4Result, null, 2);
  fs.writeFileSync(finalOutputPath, finalJsonStr, 'utf-8');
  console.log(`Successfully wrote final schedule JSON to: ${finalOutputPath}`);

  // Generate MD5 version hash (first 8 chars)
  const md5Hash = crypto.createHash('md5').update(Buffer.from(finalJsonStr, 'utf-8')).digest('hex').substring(0, 8);
  console.log(`Generated version MD5 hash: ${md5Hash}`);

  // Update manifest.json
  const manifestPath = path.resolve(process.cwd(), 'schedules/manifest.json');
  if (fs.existsSync(manifestPath)) {
    console.log(`Updating manifest.json...`);
    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf-8'));
    const relativeFilePath = `2026/${camp}/${weekStr}.json`;

    let entryFound = false;
    for (const entry of manifest.schedules || []) {
      if (entry.year === year && entry.camp === camp && entry.week === week) {
        entry.file = relativeFilePath;
        entry.version = md5Hash;
        entryFound = true;
        break;
      }
    }

    if (!entryFound) {
      manifest.schedules = manifest.schedules || [];
      manifest.schedules.push({
        year,
        camp,
        week,
        file: relativeFilePath,
        version: md5Hash,
      });
    }

    fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2), 'utf-8');
    console.log(`Successfully updated manifest.json.`);
  } else {
    console.warn(`manifest.json not found at ${manifestPath}. Skipping manifest update.`);
  }

  const durationSec = ((Date.now() - startTime) / 1000).toFixed(1);
  console.log(`Processed ${pdfPathArg} successfully in ${durationSec}s!`);
  return true;
}

async function main() {
  const args = process.argv.slice(2);
  const pdfPaths = args.filter(arg => !arg.startsWith('--'));
  const useCache = args.includes('--cache-step0') || !args.includes('--no-cache');

  if (pdfPaths.length === 0) {
    console.error('Usage: npx tsx src/index.ts <path-to-pdf1> [path-to-pdf2] ... [--no-cache]');
    process.exit(1);
  }

  const globalStart = Date.now();
  const results: { pdf: string; success: boolean; durationSec: string }[] = [];

  for (const pdf of pdfPaths) {
    const singleStart = Date.now();
    const success = await processPdf(pdf, useCache);
    const singleDuration = ((Date.now() - singleStart) / 1000).toFixed(1);
    results.push({ pdf, success, durationSec: singleDuration });

    if (!success) {
      console.error(`Pipeline halted due to failure in: ${pdf}`);
      process.exit(1);
    }
  }

  const totalDurationSec = ((Date.now() - globalStart) / 1000).toFixed(1);
  console.log(`\n=============================================`);
  console.log(`             PIPELINE RUN SUMMARY            `);
  console.log(`=============================================`);
  for (const res of results) {
    console.log(`- ${res.pdf}: ${res.success ? '✅ Success' : '❌ Failed'} (${res.durationSec}s)`);
  }
  console.log(`---------------------------------------------`);
  console.log(`Total Execution Time: ${totalDurationSec}s`);
  console.log(`=============================================\n`);
}

main().catch(err => {
  console.error('Pipeline failed with error:', err);
  process.exit(1);
});
