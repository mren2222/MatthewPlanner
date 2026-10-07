import type { MailCandidate, PlannerReply, PlannerSnapshot, ProposedAction } from '../core/types';
import { validateActions } from '../core/validation';

const normalized = (text: string) => text.normalize('NFKC').trim().toLowerCase().replace(/[\s\p{P}]+/gu, '');
export function emailActions(reply: PlannerReply, mail: MailCandidate, data: Pick<PlannerSnapshot, 'tasks' | 'fixedEvents'>, today: string): ProposedAction[] {
  if (reply.clarification) throw new Error(reply.clarification);
  const tag = `邮件线程: ${mail.threadId}`;
  const notes = (text = '') => `${tag}\n${mail.url}\n${text}`;
  const result: ProposedAction[] = [];
  for (const action of reply.actions.length ? validateActions(reply.actions) : []) {
    if (action.type === 'create_task') {
      const date = action.task.plannedDate ?? today;
      const matches = data.tasks.filter(task => normalized(task.title) === normalized(action.task.title) && task.status !== 'cancelled');
      const sameThread = matches.filter(task => task.notes?.includes(tag));
      if (sameThread.length > 1) throw new Error('邮件对应多个已有任务，需要核对。');
      if (sameThread.length) {
        result.push({ type: 'update_task', taskId: sameThread[0].id, patch: { ...action.task, plannedDate: date, notes: notes(action.task.notes) } });
      } else if (!matches.some(task => task.plannedDate === date)) result.push({ ...action, task: { ...action.task, plannedDate: date, notes: notes(action.task.notes) } });
      continue;
    }
    if (action.type === 'create_fixed_event') {
      const matches = data.fixedEvents.filter(event => normalized(event.title) === normalized(action.event.title));
      if (matches.some(event => Date.parse(event.startAt) === Date.parse(action.event.startAt) && Date.parse(event.endAt) === Date.parse(action.event.endAt))) continue;
      const sameThread = matches.filter(event => event.notes?.includes(tag));
      if (sameThread.length > 1 || sameThread.some(event => event.source === 'icloud')) throw new Error('邮件与已有日历安排有变化，需要核对。');
      if (sameThread.length) result.push({ type: 'update_fixed_event', eventId: sameThread[0].id, patch: { ...action.event, notes: notes(action.event.notes) } });
      else result.push({ ...action, event: { ...action.event, notes: notes(action.event.notes) } });
      continue;
    }
    if ('taskId' in action && ['update_task','move_task','add_note','cancel_task','change_estimate'].includes(action.type) && data.tasks.some(task => task.id === action.taskId && task.notes?.includes(tag))) { result.push(action.type === 'update_task' && action.patch.notes !== undefined ? {...action,patch:{...action.patch,notes:notes(action.patch.notes)}} : action); continue; }
    if ('eventId' in action && ['update_fixed_event','delete_fixed_event'].includes(action.type) && data.fixedEvents.some(event => event.id === action.eventId && event.source === 'local' && event.notes?.includes(tag))) { result.push(action.type === 'update_fixed_event' && action.patch.notes !== undefined ? {...action,patch:{...action.patch,notes:notes(action.patch.notes)}} : action); continue; }
    throw new Error('邮件建议涉及无关任务或完成记录，未应用；请核对原邮件。');
  }
  // Also deduplicate repeats inside the same model response, before transaction application.
  return result.filter((action,index) => result.findIndex(other => JSON.stringify(other) === JSON.stringify(action)) === index);
}
