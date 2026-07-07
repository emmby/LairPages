import * as fs from 'fs';
import * as path from 'path';
import { step3LocationFlow } from './flows/step3-location.js';

async function main() {
  const step0Path = path.resolve(process.cwd(), '.tmp/week_03_step0.json');
  const step2Path = path.resolve(process.cwd(), '.tmp/week_03_step2.json');
  const outputPath = path.resolve(process.cwd(), '.tmp/week_03_step3.json');

  if (!fs.existsSync(step0Path)) {
    console.error(`Step 0 output not found at: ${step0Path}`);
    process.exit(1);
  }
  if (!fs.existsSync(step2Path)) {
    console.error(`Step 2 output not found at: ${step2Path}`);
    process.exit(1);
  }

  console.log(`Loading Step 0 JSON...`);
  const step0 = JSON.parse(fs.readFileSync(step0Path, 'utf-8'));

  console.log(`Loading Step 2 JSON...`);
  const step2 = JSON.parse(fs.readFileSync(step2Path, 'utf-8'));

  const input = {
    camp: step0.metadata.camp,
    tracks: step2.tracks,
  };

  console.log(`Executing Step 3 Location Mapping flow...`);
  const result = await step3LocationFlow(input);

  console.log('Step 3 completed successfully!');
  
  if (!fs.existsSync(path.dirname(outputPath))) {
    fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  }
  fs.writeFileSync(outputPath, JSON.stringify(result, null, 2), 'utf-8');
  console.log(`Output written to: ${outputPath}`);
}

main().catch(err => {
  console.error('Error running Step 3:', err);
  process.exit(1);
});
