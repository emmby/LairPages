import * as fs from 'fs';
import * as path from 'path';
import { step4PostProcessFlow } from './flows/step4-postprocess.js';

async function main() {
  const step0Path = path.resolve(process.cwd(), '.tmp/week_03_step0.json');
  const step3Path = path.resolve(process.cwd(), '.tmp/week_03_step3.json');
  const outputPath = path.resolve(process.cwd(), '.tmp/week_03_step4.json');

  if (!fs.existsSync(step0Path)) {
    console.error(`Step 0 output not found at: ${step0Path}`);
    process.exit(1);
  }
  if (!fs.existsSync(step3Path)) {
    console.error(`Step 3 output not found at: ${step3Path}`);
    process.exit(1);
  }

  console.log(`Loading Step 0 JSON...`);
  const step0 = JSON.parse(fs.readFileSync(step0Path, 'utf-8'));

  console.log(`Loading Step 3 JSON...`);
  const step3 = JSON.parse(fs.readFileSync(step3Path, 'utf-8'));

  console.log(`Executing Step 4 Post-processing flow...`);
  const result = await step4PostProcessFlow({ step0, step3 });

  console.log('Step 4 completed successfully!');
  
  if (!fs.existsSync(path.dirname(outputPath))) {
    fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  }
  fs.writeFileSync(outputPath, JSON.stringify(result, null, 2), 'utf-8');
  console.log(`Output written to: ${outputPath}`);
}

main().catch(err => {
  console.error('Error running Step 4:', err);
  process.exit(1);
});
