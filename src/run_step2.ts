import * as fs from 'fs';
import * as path from 'path';
import { step2TimeFlow } from './flows/step2-time.js';

async function main() {
  const step0Path = path.resolve(process.cwd(), '.tmp/week_03_step0.json');
  const step1Path = path.resolve(process.cwd(), '.tmp/week_03_step1.json');
  const outputPath = path.resolve(process.cwd(), '.tmp/week_03_step2.json');

  if (!fs.existsSync(step0Path)) {
    console.error(`Step 0 output not found at: ${step0Path}`);
    process.exit(1);
  }
  if (!fs.existsSync(step1Path)) {
    console.error(`Step 1 output not found at: ${step1Path}`);
    process.exit(1);
  }

  console.log(`Loading Step 0 JSON...`);
  const step0 = JSON.parse(fs.readFileSync(step0Path, 'utf-8'));

  console.log(`Loading Step 1 JSON...`);
  const step1 = JSON.parse(fs.readFileSync(step1Path, 'utf-8'));

  const input = {
    startDate: step0.metadata.startDate,
    tracks: step1.tracks,
  };

  console.log(`Executing Step 2 Time Resolution flow...`);
  const result = await step2TimeFlow(input);

  console.log('Step 2 completed successfully!');
  
  if (!fs.existsSync(path.dirname(outputPath))) {
    fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  }
  fs.writeFileSync(outputPath, JSON.stringify(result, null, 2), 'utf-8');
  console.log(`Output written to: ${outputPath}`);
}

main().catch(err => {
  console.error('Error running Step 2:', err);
  process.exit(1);
});
