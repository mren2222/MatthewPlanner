import { describe, expect, it } from 'vitest';
import { actionLabel, addDays, duration, localDay } from '../src/ui/App';
import type { Task } from '../src/core/types';

const task: Task = { id: 'task-123', title: 'Portfolio', priority: 'normal', status: 'planned', plannedDate: '2026-10-07', estimatedDurationMinutes: 60, createdAt: '2026-10-07T00:00:00Z', updatedAt: '2026-10-07T00:00:00Z' };
const snapshot = { tasks: [task], fixedEvents: [] };

describe('planner presentation', () => {
  it('keeps date arithmetic in local calendar days across month and year boundaries', () => {
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
    expect(addDays('2026-03-08', 1)).toBe('2026-03-09');
    expect(localDay(new Date(2026, 9, 7, 23, 55))).toBe('2026-10-07');
  });
  it('shows unknown estimates without representing them as zero', () => {
    expect(duration(undefined)).toBe('No estimate');
    expect(duration(90)).toBe('1h 30m');
    expect(duration(0)).toBe('0m');
  });
  it('resolves proposal task identifiers into readable titles', () => {
    expect(actionLabel({ type: 'move_task', taskId: task.id, plannedDate: '2026-10-09' }, snapshot)).toContain('Portfolio');
    expect(actionLabel({ type: 'move_task', taskId: task.id, plannedDate: '2026-10-09' }, snapshot).includes('task-123')).toBe(false);
  });
  it('labels inferred history distinctly in proposal previews', () => {
    expect(actionLabel({ type: 'complete_task', taskId: task.id, activity: { durationMinutes: 65, confidence: 'inferred', source: 'ai_inferred' } }, snapshot)).toContain('1h 5m actual · inferred');
  });
  it('makes flexible tasks and exact fixed events visibly distinct', () => {
    const flexible = actionLabel({ type: 'create_task', task: { title: 'Interview prep', estimatedDurationMinutes: 60 } }, snapshot);
    const fixed = actionLabel({ type: 'create_fixed_event', event: { title: 'Interview', startAt: '2026-10-07T10:00:00-07:00', endAt: '2026-10-07T10:30:00-07:00', timezone: 'America/Los_Angeles' } }, snapshot);
    expect(flexible).toContain('Inbox');
    expect(flexible).toContain('1h');
    expect(fixed).toContain('fixed event');
    expect(fixed).toContain('start:');
    expect(fixed).toContain('end:');
  });
  it('previews all mutated task fields and historical timestamps', () => {
    const taskPreview = actionLabel({ type: 'create_task', task: { title: 'Prep', priority: 'high', projectId: 'Interviews', deadline: '2026-10-08', notes: 'Read brief', description: 'Practice' } }, snapshot);
    for (const value of ['high','Interviews','2026-10-08','Read brief','Practice']) expect(taskPreview).toContain(value);
    const activity = actionLabel({ type: 'complete_task', taskId: task.id, activity: { durationMinutes: 60, confidence: 'inferred', source: 'ai_inferred', startAt: '2026-10-07T09:00:00-07:00', endAt: '2026-10-07T10:00:00-07:00' } }, snapshot);
    expect(activity).toContain('2026'); expect(activity).toContain('→'); expect(activity).toContain('inferred');
  });
});
