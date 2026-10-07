export type TaskStatus = 'inbox' | 'planned' | 'completed' | 'cancelled';
export type Priority = 'low' | 'normal' | 'high';
export type ActivityTimeConfidence = 'exact' | 'approximate' | 'inferred';
export interface Task {
  id: string; title: string; description?: string; projectId?: string;
  status: TaskStatus; priority: Priority; plannedDate?: string; deadline?: string;
  estimatedDurationMinutes?: number; actualDurationMinutes?: number;
  actualStart?: string; actualEnd?: string; actualTimeConfidence?: ActivityTimeConfidence;
  createdAt: string; updatedAt: string; completedAt?: string; cancelledAt?: string; notes?: string;
}
export type TaskInput = Pick<Task, 'title'> & Partial<Pick<Task, 'description' | 'projectId' | 'priority' | 'plannedDate' | 'deadline' | 'estimatedDurationMinutes' | 'notes'>>;
export type TaskPatch = Partial<TaskInput>;
export interface FixedEvent {
  id: string; title: string; startAt: string; endAt: string; timezone: string;
  location?: string; notes?: string; source: 'local' | 'icloud'; externalId?: string;
  calendarProvider?: string; calendarId?: string; etag?: string; linkedTaskId?: string;
  createdAt: string; updatedAt: string;
}
export type FixedEventInput = Pick<FixedEvent, 'title' | 'startAt' | 'endAt' | 'timezone'> & Partial<Pick<FixedEvent, 'location' | 'notes' | 'linkedTaskId'>>;
export interface ActivityRecord {
  id: string; taskId: string; startAt?: string; endAt?: string; durationMinutes: number;
  confidence: ActivityTimeConfidence; source: 'manual' | 'ai_inferred' | 'timer' | 'import'; createdAt: string;
}
export type ActivityInput = Omit<ActivityRecord, 'id' | 'taskId' | 'createdAt'>;
export type ProposedAction =
  | { type: 'create_task'; task: TaskInput }
  | { type: 'update_task'; taskId: string; patch: TaskPatch }
  | { type: 'complete_task'; taskId: string; activity?: ActivityInput }
  | { type: 'cancel_task'; taskId: string }
  | { type: 'move_task'; taskId: string; plannedDate: string }
  | { type: 'change_estimate'; taskId: string; estimatedDurationMinutes: number }
  | { type: 'add_note'; taskId: string; note: string }
  | { type: 'record_activity'; taskId: string; activity: ActivityInput }
  | { type: 'create_fixed_event'; event: FixedEventInput }
  | { type: 'update_fixed_event'; eventId: string; patch: Partial<FixedEventInput> }
  | { type: 'delete_fixed_event'; eventId: string };
export interface AuditEntry {
  id: string; batchId: string; actionType: string; entityId: string;
  before: Task | FixedEvent | null; after: Task | FixedEvent | null;
  timestamp: string; origin: 'manual' | 'ai' | 'calendar' | 'undo'; sourceMessage?: string; undone: boolean;
}
export interface ChatMessage { id: string; role: 'user' | 'assistant'; content: string; createdAt: string; proposalId?: string }
export interface PlannerContext {
  today: string; now: string; timezone: string; tasks: Task[]; fixedEvents: FixedEvent[];
  activities: ActivityRecord[]; history: AuditEntry[]; messages: ChatMessage[];
}
export interface PlannerReply { message: string; actions: ProposedAction[]; clarification?: string }
export interface Proposal extends PlannerReply { id: string; baseRevision: number; sourceMessage: string; status: 'pending' | 'applied' | 'cancelled'; createdAt: string }
export interface SettingsSummary { aiConfigured: boolean; aiModel: string; calendarConfigured: boolean; calendarId?: string; appleAccount?: string; secureStorageAvailable: boolean }
export interface PlannerSnapshot {
  revision: number; tasks: Task[]; fixedEvents: FixedEvent[]; activities: ActivityRecord[];
  history: AuditEntry[]; messages: ChatMessage[]; proposals: Proposal[]; settings: SettingsSummary;
}
export interface CalendarInfo { id: string; name: string; readOnly?: boolean }
export interface SettingsInput { openaiKey?: string; aiModel?: string; appleAccount?: string; applePassword?: string; calendarId?: string; clearAI?: boolean; clearCalendar?: boolean }
export interface PlannerAPI {
  snapshot(): Promise<PlannerSnapshot>;
  apply(actions: ProposedAction[], expectedRevision: number): Promise<PlannerSnapshot>;
  undo(): Promise<PlannerSnapshot>;
  chat(message: string): Promise<PlannerSnapshot>;
  applyProposal(id: string): Promise<PlannerSnapshot>;
  cancelProposal(id: string): Promise<PlannerSnapshot>;
  reviewToday(): Promise<PlannerSnapshot>;
  saveSettings(settings: SettingsInput): Promise<PlannerSnapshot>;
  listCalendars(): Promise<CalendarInfo[]>;
  syncCalendar(): Promise<PlannerSnapshot>;
  publishEvent(eventId: string): Promise<PlannerSnapshot>;
}
