import * as fs from 'fs';
import * as path from 'path';
import { step5EvaluateFlow } from './flows/step5-evaluate.js';

async function main() {
  const step0Path = path.resolve(process.cwd(), '.tmp/week_03_step0.json');
  const step4Path = path.resolve(process.cwd(), '.tmp/week_03_step4.json');

  if (!fs.existsSync(step0Path)) {
    console.error(`Step 0 output not found at: ${step0Path}`);
    process.exit(1);
  }
  if (!fs.existsSync(step4Path)) {
    console.error(`Step 4 output not found at: ${step4Path}`);
    process.exit(1);
  }

  console.log(`Loading Step 0 JSON...`);
  const step0 = JSON.parse(fs.readFileSync(step0Path, 'utf-8'));

  console.log(`Loading Step 4 JSON...`);
  const step4 = JSON.parse(fs.readFileSync(step4Path, 'utf-8'));

  console.log(`Executing Step 5 Evaluation flow...`);
  const result = await step5EvaluateFlow({ step0, step4 });

  console.log('\n=============================================');
  console.log('            EVALUATION REPORT               ');
  console.log('=============================================');
  console.log(`Score:  ${result.score}/5`);
  console.log(`Passed: ${result.passed ? '✅ YES' : '❌ NO'}`);
  console.log('---------------------------------------------');
  console.log('Findings:');
  if (result.findings.length === 0) {
    console.log('  No issues or warnings found.');
  } else {
    for (const finding of result.findings) {
      const icon = finding.severity === 'critical' ? '❌' : (finding.severity === 'warning' ? '⚠️' : 'ℹ️');
      const context = finding.locationContext ? ` (${finding.locationContext})` : '';
      console.log(`  ${icon} [${finding.severity.toUpperCase()}]${context}: ${finding.message}`);
    }
  }
  console.log('=============================================\n');

  if (!result.passed) {
    console.error('Audit failed! Please review critical issues above.');
    process.exit(1);
  } else {
    console.log('Audit passed successfully!');
  }
}

main().catch(err => {
  console.error('Error running Step 5:', err);
  process.exit(1);
});
