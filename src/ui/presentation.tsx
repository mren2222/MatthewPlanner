import type { ReactNode } from 'react';
import type { PlannerAPI, PlannerSnapshot, ProposedAction } from '../core/types';

declare global { interface Window { planner: PlannerAPI } }

export function localDay(date = new Date()): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}
export function addDays(day: string, offset: number): string {
  const date = new Date(`${day}T12:00:00`); date.setDate(date.getDate() + offset); return localDay(date);
}
export function duration(minutes?: number): string {
  if (minutes === undefined) return 'No estimate';
  return minutes >= 60 ? `${Math.floor(minutes / 60)}h${minutes % 60 ? ` ${minutes % 60}m` : ''}` : `${minutes}m`;
}
export function dateLabel(day: string, options: Intl.DateTimeFormatOptions = { month: 'short', day: 'numeric' }): string {
  return new Date(`${day}T12:00:00`).toLocaleDateString('zh-CN', options);
}
export function timeLabel(value: string): string { return new Date(value).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', hour12: false }); }
export function localDateTime(value: string): string {
  const date = new Date(value); return `${localDay(date)}T${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
}
export function Icon({ name, size = 18 }: { name: 'sun' | 'days' | 'inbox' | 'check' | 'history' | 'settings' | 'plus' | 'arrow' | 'chat' | 'undo'; size?: number }) {
  const paths: Record<string, ReactNode> = {
    sun: <><circle cx="12" cy="12" r="4"/><path d="M12 2v2m0 16v2M2 12h2m16 0h2M5 5l1.5 1.5m11 11L19 19M5 19l1.5-1.5m11-11L19 5"/></>,
    days: <><rect x="3" y="5" width="18" height="16" rx="3"/><path d="M7 3v4m10-4v4M3 10h18m-13 4h3m3 0h3m-9 4h3"/></>,
    inbox: <><path d="M3 14l3-9h12l3 9v6H3zM3 14h5l2 3h4l2-3h5"/></>,
    check: <><circle cx="12" cy="12" r="9"/><path d="m8 12 3 3 5-6"/></>,
    history: <><path d="M3 10a9 9 0 1 1 2 8M3 4v6h6m3-3v5l3 2"/></>,
    settings: <><circle cx="12" cy="12" r="3"/><path d="m9 3-1 3-3 1-2 4 2 2v3l4 3 3-1 3 1 4-3v-3l2-2-2-4-3-1-1-3z"/></>,
    plus: <path d="M12 5v14M5 12h14"/>, arrow: <path d="M5 12h14m-5-5 5 5-5 5"/>,
    chat: <path d="M5 4h14a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H9l-6 3V6a2 2 0 0 1 2-2zm2 5h10m-10 4h7"/>,
    undo: <path d="M8 5 3 10l5 5M3 10h11a6 6 0 0 1 0 12"/>,
  };
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.65" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{paths[name]}</svg>;
}

export function actionLabel(action: ProposedAction, snapshot: Pick<PlannerSnapshot, 'tasks' | 'fixedEvents'>): string {
  const task = 'taskId' in action ? snapshot.tasks.find(t => t.id === action.taskId)?.title ?? 'Unavailable task' : '';
  const event = 'eventId' in action ? snapshot.fixedEvents.find(e => e.id === action.eventId)?.title ?? 'Unavailable event' : '';
  const fullTime = (value: string, timezone?: string) => new Date(value).toLocaleString(undefined, { ...(timezone ? { timeZone: timezone } : {}), year: 'numeric', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
  const values = (input: Record<string, unknown>) => Object.entries(input).map(([key, value]) => {
    const label = ({ title: 'title', plannedDate: 'day', estimatedDurationMinutes: 'estimate', projectId: 'category', startAt: 'start', endAt: 'end', linkedTaskId: 'linked task' } as Record<string,string>)[key] ?? key;
    if (value === undefined) return `clear ${label}`;
    if (key === 'estimatedDurationMinutes') return `${label}: ${duration(Number(value))}`;
    if (key === 'startAt' || key === 'endAt') return `${label}: ${fullTime(String(value), typeof input.timezone === 'string' ? input.timezone : undefined)}`;
    if (key === 'linkedTaskId') return `${label}: ${snapshot.tasks.find(t => t.id === value)?.title ?? String(value)}`;
    return `${label}: ${String(value)}`;
  }).join(' · ');
  const activityLabel = (activity: { durationMinutes: number; confidence: string; startAt?: string; endAt?: string }) => `${duration(activity.durationMinutes)} actual · ${activity.confidence}${activity.startAt ? ` · ${fullTime(activity.startAt)} → ${activity.endAt ? fullTime(activity.endAt) : 'end unknown'}` : ' · no interval recorded'}`;
  switch (action.type) {
    case 'create_task': return `Add task · ${values(action.task as unknown as Record<string,unknown>)}${action.task.plannedDate ? '' : ' · Inbox'}`;
    case 'move_task': return `Move “${task}” → ${dateLabel(action.plannedDate)}`;
    case 'complete_task': return `Complete “${task}”${action.activity ? ` · ${activityLabel(action.activity)}` : ' · actual duration unknown'}`;
    case 'reopen_task': return '恢复任务';
    case 'set_day_note': return '保存 Notes';
    case 'update_activity': return '修改完成记录';
    case 'cancel_task': return `Cancel “${task}”`;
    case 'change_estimate': return `Estimate “${task}” → ${duration(action.estimatedDurationMinutes)}`;
    case 'add_note': return `Add note to “${task}”: ${action.note}`;
    case 'record_activity': return `Record “${task}” · ${activityLabel(action.activity)}`;
    case 'update_task': return `Update “${task}” · ${values(action.patch as Record<string,unknown>)}`;
    case 'create_fixed_event': return `Add fixed event · ${values(action.event as unknown as Record<string,unknown>)}`;
    case 'update_fixed_event': return `Update fixed event “${event}” · ${values(action.patch as Record<string,unknown>)}`;
    case 'delete_fixed_event': return `Delete fixed event “${event}”`;
  }
}
