import type { ActivityInput, ActivityRecord, FixedEvent, Task } from '../core/types';

/** Local retrospective placement, never a scheduled Task or a CalendarProvider input. */
export function completionActivity(task: Task, activities: ActivityRecord[], events: FixedEvent[], now = new Date(), stated?: ActivityInput): ActivityInput {
  if (stated?.startAt && stated.endAt) return stated;
  const durationMinutes = Math.min(stated?.durationMinutes ?? task.estimatedDurationMinutes ?? 30, 1440);
  const duration = durationMinutes * 60000;
  let end = now.getTime();
  // Keep generated blocks away from known events/history; explicit recollections can overlap.
  const occupied = [...activities, ...events.filter(event => !event.allDay)].flatMap(item => item.startAt && item.endAt ? [{ start: Date.parse(item.startAt), end: Date.parse(item.endAt) }] : []);
  for (let tries = 0; tries <= occupied.length; tries++) {
    const overlaps = occupied.filter(item => end - duration < item.end && end > item.start);
    if (!overlaps.length) break;
    end = Math.min(...overlaps.map(item => item.start));
  }
  return { durationMinutes, startAt: new Date(end - duration).toISOString(), endAt: new Date(end).toISOString(), confidence: 'inferred', source: 'ai_inferred' };
}
