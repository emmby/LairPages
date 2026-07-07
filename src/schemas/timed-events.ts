import { z } from 'zod';

export const TimeResolutionSchema = z.object({
  uniqueId: z.number().describe('The sequential unique index of the event from the input list.'),
  startTime: z.string().describe("ISO 8601 datetime format with PDT -07:00 offset (e.g. '2026-06-20T15:00:00-07:00'). Must be zero-padded (e.g. T07:00:00-07:00)."),
  endTime: z.string().nullable().optional().describe("ISO 8601 datetime format with PDT -07:00 offset (e.g. '2026-06-20T17:30:00-07:00'). Null if no end time was specified."),
});

export const TimeResolutionResultsSchema = z.object({
  resolutions: z.array(TimeResolutionSchema),
});

export const TimedEventSchema = z.object({
  startTime: z.string(),
  endTime: z.string().nullable().optional(),
  title: z.string(),
  location: z.string().nullable().optional(),
  description: z.string().nullable().optional(),
});

export const TrackTimedEventsSchema = z.object({
  trackName: z.string(),
  events: z.array(TimedEventSchema),
});

export const Step2OutputSchema = z.object({
  tracks: z.array(TrackTimedEventsSchema),
});

export type TimeResolution = z.infer<typeof TimeResolutionSchema>;
export type TimeResolutionResults = z.infer<typeof TimeResolutionResultsSchema>;
export type TimedEvent = z.infer<typeof TimedEventSchema>;
export type TrackTimedEvents = z.infer<typeof TrackTimedEventsSchema>;
export type Step2Output = z.infer<typeof Step2OutputSchema>;
