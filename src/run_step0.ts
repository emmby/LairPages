import { step0ExtractFlow } from './flows/step0-extract.js';
import * as fs from 'fs';
import * as path from 'path';

async function main() {
  const pdfPath = 'schedules/2026/oski/week_03.pdf';
  console.log(`Running Step 0 on: ${pdfPath}`);
  
  try {
    const result = await step0ExtractFlow({ pdfPath });
    console.log('Step 0 completed successfully!');
    
    const outPath = path.resolve(process.cwd(), '.tmp/week_03_step0.json');
    fs.mkdirSync(path.dirname(outPath), { recursive: true });
    fs.writeFileSync(outPath, JSON.stringify(result, null, 2), 'utf-8');
    console.log(`Output written to: ${outPath}`);
  } catch (error) {
    console.error('Error running Step 0:', error);
    process.exit(1);
  }
}

main();
