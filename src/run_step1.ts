import * as fs from 'fs';
import * as path from 'path';
import { step1EventsFlow } from './flows/step1-events.js';

async function main() {
  const step0Path = path.resolve(process.cwd(), '.tmp/week_03_step0.json');
  const outputPath = path.resolve(process.cwd(), '.tmp/week_03_step1.json');

  if (!fs.existsSync(step0Path)) {
    console.error(`Step 0 raw grid output not found at: ${step0Path}`);
    console.error('Please run Step 0 first using: npx tsx src/run_step0.ts');
    process.exit(1);
  }

  console.log(`Loading Step 0 raw grid JSON from: ${step0Path}`);
  const rawGrid = JSON.parse(fs.readFileSync(step0Path, 'utf-8'));

  console.log('Executing Step 1 Event Extraction flow...');
  const result = await step1EventsFlow(rawGrid);

  console.log('Step 1 completed successfully!');
  
  if (!fs.existsSync(path.dirname(outputPath))) {
    fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  }
  fs.writeFileSync(outputPath, JSON.stringify(result, null, 2), 'utf-8');
  console.log(`Output written to: ${outputPath}`);
}

main().catch(err => {
  console.error('Error running Step 1:', err);
  process.exit(1);
});
