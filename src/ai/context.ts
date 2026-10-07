import type { PlannerContext, Task } from '../core/types';

// Project data is untrusted text. Credentials are never selected from settings;
// this extra redaction also prevents accidental pasted secrets entering prompts.
export function redactText(value: string, limit = 800): string {
  return value
    .replace(/\bsk-[A-Za-z0-9_-]{8,}\b/g, '[redacted key]')
    .replace(/\b[A-Za-z0-9]{4}(?:-[A-Za-z0-9]{4}){3}\b/g, '[redacted app password]')
    .replace(/\b(?:api[_ -]?key|password|authorization|secret|token)\s*[:=]\s*[^\s,;]+/gi, '[redacted credential]')
    .replace(/\bBearer\s+[^\s,;]+/gi, '[redacted authorization]')
    .slice(0, limit);
}

export function buildPlannerContext(context: PlannerContext, message = '') {
  const rank = (task: Task) =>
    (message.toLowerCase().includes(task.title.toLowerCase()) ? 100 : 0)
    + (task.plannedDate === context.today ? 20 : 0)
    + (['inbox', 'planned'].includes(task.status) ? 10 : 0);
  return {
    today: context.today, now: context.now, timezone: context.timezone,
    tasks: [...context.tasks].sort((a, b) => rank(b) - rank(a)).slice(0, 80).map(task => ({
      id: task.id, title: redactText(task.title, 200), status: task.status,
      priority: task.priority, plannedDate: task.plannedDate, deadline: task.deadline,
      projectId: task.projectId ? redactText(task.projectId, 100) : undefined,
      estimatedDurationMinutes: task.estimatedDurationMinutes,
      actualDurationMinutes: task.actualDurationMinutes,
      notes: task.notes ? redactText(task.notes, 400) : undefined,
    })),
    fixedEvents: context.fixedEvents.filter(event => event.startAt.slice(0, 10) >= context.today)
      .slice(0, 30).map(event => ({ id: event.id, title: redactText(event.title, 200),
        startAt: event.startAt, endAt: event.endAt, timezone: event.timezone,
        linkedTaskId: event.linkedTaskId })),
    activities: context.activities.slice(-30).map(activity => ({ taskId: activity.taskId,
      startAt: activity.startAt, endAt: activity.endAt, durationMinutes: activity.durationMinutes,
      confidence: activity.confidence })),
    history: context.history.slice(-30).map(entry => ({ actionType: entry.actionType,
      entityId: entry.entityId, timestamp: entry.timestamp, undone: entry.undone })),
    messages: context.messages.slice(-6).map(entry => ({ role: entry.role,
      content: redactText(entry.content, 600) })),
    truncated: context.tasks.length > 80 || context.fixedEvents.length > 30,
  };
}
