import { z } from 'zod';

const nonEmptyString = z.string().transform(s => s.trim()).refine(s => s.length > 0, 'String cannot be empty');

const nullableNonEmptyString = z.string().nullable().optional()
  .transform(s => {
    if (!s) return null;
    const trimmed = s.trim();
    return trimmed.length > 0 ? trimmed : null;
  });

export const RawDayEnum = z.enum([
  'Saturday',
  'Sunday',
  'Monday',
  'Tuesday',
  'Wednesday',
  'Thursday',
  'Friday',
]);

export const RawEventSchema = z.object({
  rawDay: RawDayEnum.describe('The specific single day name of the week for this event (e.g., "Sunday", "Monday"). Do not output range strings like "Sunday - Friday" or "Daily".'),
  rawTime: nonEmptyString.describe('Raw time range as shown in colB (e.g. "2:30-4:00 PM"). Must be non-empty.'),
  title: nonEmptyString.describe('Extracted event title. Must be non-empty.'),
  location: nullableNonEmptyString.describe('Extracted location text. Null if not specified.'),
  description: nullableNonEmptyString.describe('Additional event details, rules, or lists. Null if none.'),
});

export const TrackEventsSchema = z.object({
  trackName: nonEmptyString.describe('The name of the track this group of events belongs to'),
  events: z.array(RawEventSchema).describe('The extracted events for this track'),
});

export const Step1OutputSchema = z.object({
  tracks: z.array(TrackEventsSchema),
});

export const Step1BatchOutputSchema = z.object({
  tracks: z.array(TrackEventsSchema),
});

export type RawEvent = z.infer<typeof RawEventSchema>;
export type TrackEvents = z.infer<typeof TrackEventsSchema>;
export type Step1Output = z.infer<typeof Step1OutputSchema>;
