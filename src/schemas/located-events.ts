import { z } from 'zod';

export const LocationMappingSchema = z.object({
  rawLocation: z.string().describe('The original raw location string from the event.'),
  mappedLocation: z.string().nullable().describe('The resolved maplocation markdown link string, or null if it cannot be mapped to any known location.'),
});

export const LocationMappingResultsSchema = z.object({
  mappings: z.array(LocationMappingSchema),
});

export const LocatedEventSchema = z.object({
  startTime: z.string(),
  endTime: z.string().nullable().optional(),
  title: z.string(),
  location: z.string().nullable().optional(),
  description: z.string(),
});

export const TrackLocatedEventsSchema = z.object({
  trackName: z.string(),
  events: z.array(LocatedEventSchema),
});

export const Step3OutputSchema = z.object({
  tracks: z.array(TrackLocatedEventsSchema),
});

export type LocationMapping = z.infer<typeof LocationMappingSchema>;
export type LocationMappingResults = z.infer<typeof LocationMappingResultsSchema>;
export type LocatedEvent = z.infer<typeof LocatedEventSchema>;
export type TrackLocatedEvents = z.infer<typeof TrackLocatedEventsSchema>;
export type Step3Output = z.infer<typeof Step3OutputSchema>;
