import { z } from 'zod';

export const FinalEventSchema = z.object({
  id: z.string().uuid(),
  startTime: z.string(),
  endTime: z.string().nullable().optional(),
  title: z.string(),
  location: z.string().nullable().optional(),
  description: z.string().nullable().optional(),
});

export const FinalTrackSchema = z.object({
  name: z.string(),
  banner: z.string().nullable().optional(),
  events: z.array(FinalEventSchema),
});

export const FinalScheduleSchema = z.object({
  tracks: z.array(FinalTrackSchema),
});

export type FinalEvent = z.infer<typeof FinalEventSchema>;
export type FinalTrack = z.infer<typeof FinalTrackSchema>;
export type FinalSchedule = z.infer<typeof FinalScheduleSchema>;
