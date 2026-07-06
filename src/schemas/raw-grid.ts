import { z } from 'zod';

const trimmedString = z.string().transform(s => s.trim());
const nullableTrimmedString = z.string().nullable().optional().transform(s => s ? s.trim() : null);

export const RawGridCellSchema = z.object({
  colA: trimmedString.describe('Left-most column cell text (Day of the week). Always present due to forward-filling.'),
  colB: nullableTrimmedString.describe('Middle column cell text (Time). Null if empty or horizontally spanned.'),
  colC: trimmedString.describe('Right-most column cell text (Event description or warning/header text). Always present.'),
});

export const RawGridTrackSchema = z.object({
  name: trimmedString.describe('Track/category name (e.g. "Pool", "Arts and Crafts", "General Daily Times")'),
  banner: nullableTrimmedString.describe('Track-level policies or announcements. Null if none.'),
  cells: z.array(RawGridCellSchema).min(1).describe('All grid cells belonging to this track'),
});

export const RawGridSchema = z.object({
  metadata: z.object({
    year: z.number().int().describe('Extract the 4-digit year (e.g. 2026)'),
    camp: z.enum(['blue', 'gold', 'oski']).describe('Camp ID: "blue", "gold", or "oski"'),
    week: z.number().int().min(1).max(11).describe('Week number of the camp session (1-11)'),
    startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).describe('Saturday check-in date as YYYY-MM-DD'),
  }),
  tracks: z.array(RawGridTrackSchema),
});

export type RawGridCell = z.infer<typeof RawGridCellSchema>;
export type RawGridTrack = z.infer<typeof RawGridTrackSchema>;
export type RawGrid = z.infer<typeof RawGridSchema>;
