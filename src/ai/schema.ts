// Responses strict JSON schema requires every property to be required. Nullable
// optional fields below are removed before canonical domain validation.
const string = { type: 'string' };
const nullableString = { anyOf: [string, { type: 'null' }] };
const minutes = { type: 'integer', minimum: 1, maximum: 1440 };
const nullableMinutes = { anyOf: [minutes, { type: 'null' }] };
const nullable = (schema: unknown) => ({ anyOf: [schema, { type: 'null' }] });
const object = (properties: Record<string, unknown>) => ({ type: 'object', properties,
  required: Object.keys(properties), additionalProperties: false });
const task = object({ title: string, description: nullableString, projectId: nullableString,
  priority: nullable({ type: 'string', enum: ['low', 'normal', 'high'] }),
  plannedDate: nullableString, deadline: nullableString, estimatedDurationMinutes: nullableMinutes,
  notes: nullableString });
const taskPatch = object({ ...task.properties, title: nullableString });
const activity = object({ startAt: nullableString, endAt: nullableString, durationMinutes: minutes,
  confidence: { type: 'string', enum: ['exact', 'approximate', 'inferred'] },
  source: { type: 'string', enum: ['manual', 'ai_inferred', 'timer', 'import'] } });
const event = object({ title: string, startAt: string, endAt: string, timezone: string,
  location: nullableString, notes: nullableString, linkedTaskId: nullableString });
const eventPatch = object(Object.fromEntries(Object.entries(event.properties).map(([key]) => [key, nullableString])));
const action = (type: string, fields: Record<string, unknown>) => object({ type: { type: 'string', enum: [type] }, ...fields });

export const plannerReplySchema = object({ message: string, clarification: nullableString,
  actions: { type: 'array', maxItems: 30, items: { anyOf: [
    action('create_task', { task }), action('update_task', { taskId: string, patch: taskPatch }),
    action('complete_task', { taskId: string, activity: nullable(activity), completedDate: nullableString }),
    action('reopen_task', { taskId: string }), action('set_day_note', { date: string, text: string }),
    action('cancel_task', { taskId: string }), action('move_task', { taskId: string, plannedDate: string }),
    action('change_estimate', { taskId: string, estimatedDurationMinutes: minutes }),
    action('add_note', { taskId: string, note: string }), action('record_activity', { taskId: string, activity }),
    action('create_fixed_event', { event }), action('update_fixed_event', { eventId: string, patch: eventPatch }),
    action('delete_fixed_event', { eventId: string }),
  ] } } });

export function removeNulls(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(removeNulls);
  if (value !== null && typeof value === 'object') return Object.fromEntries(
    Object.entries(value).filter(([, item]) => item !== null).map(([key, item]) => [key, removeNulls(item)]));
  return value;
}
