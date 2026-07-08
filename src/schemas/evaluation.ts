import { z } from 'zod';

export const EvaluationFindingSchema = z.object({
  severity: z.enum(['info', 'warning', 'critical']).describe('Severity level: info (minor note), warning (non-critical issue), critical (data corruption/missing event).'),
  message: z.string().describe('Detailed description of the issue or verification check.'),
  locationContext: z.string().optional().describe('Contextual information like track name or event title.'),
});

export const EvaluationResultsSchema = z.object({
  score: z.number().min(0).max(5).describe('Human-friendly score out of 5 (rubric: 5=perfect, 4=minor warnings, 3=minor errors, 2=critical issues, 1=severe, 0=total mismatch).'),
  passed: z.boolean().describe('True ONLY if score is 4 or 5 (zero critical issues).'),
  findings: z.array(EvaluationFindingSchema).describe('List of detailed findings from the audit.'),
});

export type EvaluationFinding = z.infer<typeof EvaluationFindingSchema>;
export type EvaluationResults = z.infer<typeof EvaluationResultsSchema>;
