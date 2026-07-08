import { z } from 'zod';
import { ai, runWithRetry } from '../lib/genkit.js';
import { RawGridSchema } from '../schemas/raw-grid.js';
import { FinalScheduleSchema } from '../schemas/schedule.js';
import { EvaluationResultsSchema } from '../schemas/evaluation.js';

export const Step5InputSchema = z.object({
  step0: RawGridSchema,
  step4: FinalScheduleSchema,
});

export const step5EvaluateFlow = ai.defineFlow(
  {
    name: 'step5Evaluate',
    inputSchema: Step5InputSchema,
    outputSchema: EvaluationResultsSchema,
  },
  async (input) => {
    const step5Prompt = ai.prompt('step5-evaluate');
    
    console.log('Sending Step 0 and Step 4 output to LLM judge for verification...');
    
    const response = await runWithRetry(() =>
      step5Prompt(
        { step0: input.step0, step4: input.step4 },
        {
          output: { schema: EvaluationResultsSchema },
        }
      )
    );

    if (!response.output) {
      throw new Error('LLM judge failed to return structured evaluation results.');
    }

    return response.output;
  }
);
