import { z } from 'zod';
import type { ProposedAction } from './types';

const text = z.string().trim().min(1).max(10000);
const id = z.string().trim().min(1).max(256);
const optionalText = z.string().max(50000).optional();
export const localDateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(value => {
  const date = new Date(`${value}T00:00:00.000Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}, 'Invalid calendar date');
export const timestampSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?(?:Z|[+-]\d{2}:\d{2})$/).refine(value => {
  const match = value.match(/T(\d{2}):(\d{2}):(\d{2})(?:\.\d+)?(Z|[+-](\d{2}):(\d{2}))$/);
  return localDateSchema.safeParse(value.slice(0, 10)).success && !!match &&
    Number(match[1]) < 24 && Number(match[2]) < 60 && Number(match[3]) < 60 &&
    (match[4] === 'Z' || (Number(match[5]) < 24 && Number(match[6]) < 60)) && Number.isFinite(Date.parse(value));
}, 'Invalid ISO timestamp with timezone');
const minutes = z.number().finite().positive().max(525600);
const timezone = z.string().min(1).max(128).refine(value => {
  try { new Intl.DateTimeFormat('en-US', { timeZone: value }); return true; } catch { return false; }
}, 'Invalid IANA timezone');
const taskFields = {
  title: text, description: optionalText, projectId: id.optional(),
  priority: z.enum(['low', 'normal', 'high']).optional(), plannedDate: localDateSchema.optional(),
  deadline: localDateSchema.optional(), estimatedDurationMinutes: minutes.optional(), notes: optionalText,
};
const taskInput = z.object(taskFields).strict();
const taskPatch = taskInput.partial().refine(value => Object.keys(value).length > 0, 'Empty task update')
  .refine(value => !Object.hasOwn(value, 'title') || value.title !== undefined, 'Task title cannot be cleared')
  .refine(value => !Object.hasOwn(value, 'priority') || value.priority !== undefined, 'Task priority cannot be cleared');
const eventFields = {
  title: text, startAt: timestampSchema, endAt: timestampSchema, timezone,
  location: optionalText, notes: optionalText, linkedTaskId: id.optional(),
};
const eventInput = z.object(eventFields).strict().refine(value => Date.parse(value.endAt) > Date.parse(value.startAt), 'Event end must follow start');
const eventPatch = z.object(eventFields).partial().strict().refine(value => Object.keys(value).length > 0, 'Empty event update')
  .refine(value => ['title', 'startAt', 'endAt', 'timezone'].every(key => !Object.hasOwn(value, key) || value[key as keyof typeof value] !== undefined), 'Required event fields cannot be cleared');
export const activityInputSchema = z.object({
  startAt: timestampSchema.optional(), endAt: timestampSchema.optional(), durationMinutes: minutes,
  confidence: z.enum(['exact', 'approximate', 'inferred']), source: z.enum(['manual', 'ai_inferred', 'timer', 'import']),
}).strict().refine(value => !(value.endAt && !value.startAt), 'Activity end requires start')
  .refine(value => value.source !== 'ai_inferred' || value.confidence === 'inferred', 'AI inferred activity must be labelled inferred')
  .refine(value => !value.startAt || !value.endAt || Date.parse(value.endAt) > Date.parse(value.startAt), 'Activity end must follow start');
const action = z.discriminatedUnion('type', [
  z.object({ type: z.literal('create_task'), task: taskInput }).strict(),
  z.object({ type: z.literal('update_task'), taskId: id, patch: taskPatch }).strict(),
  z.object({ type: z.literal('complete_task'), taskId: id, activity: activityInputSchema.optional() }).strict(),
  z.object({ type: z.literal('cancel_task'), taskId: id }).strict(),
  z.object({ type: z.literal('move_task'), taskId: id, plannedDate: localDateSchema }).strict(),
  z.object({ type: z.literal('change_estimate'), taskId: id, estimatedDurationMinutes: minutes }).strict(),
  z.object({ type: z.literal('add_note'), taskId: id, note: text }).strict(),
  z.object({ type: z.literal('record_activity'), taskId: id, activity: activityInputSchema }).strict(),
  z.object({ type: z.literal('create_fixed_event'), event: eventInput }).strict(),
  z.object({ type: z.literal('update_fixed_event'), eventId: id, patch: eventPatch }).strict(),
  z.object({ type: z.literal('delete_fixed_event'), eventId: id }).strict(),
]);
export function validateActions(input: unknown): ProposedAction[] {
  return z.array(action).min(1).max(100).parse(input) as ProposedAction[];
}
export const fixedEventSchema = z.object({
  ...eventFields, id, source: z.enum(['local', 'icloud']), externalId: id.optional(),
  calendarProvider: id.optional(), calendarId: id.optional(), etag: z.string().max(4096).optional(),
  createdAt: timestampSchema, updatedAt: timestampSchema,
}).strict().refine(value => Date.parse(value.endAt) > Date.parse(value.startAt), 'Event end must follow start');
