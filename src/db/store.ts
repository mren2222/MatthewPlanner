import initSqlJs, { type Database, type SqlJsStatic } from 'sql.js';
import { createHash, randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, openSync, writeFileSync, fsyncSync, closeSync, renameSync, unlinkSync } from 'node:fs';
import { dirname } from 'node:path';
import { z } from 'zod';
import type { ActivityInput, ActivityRecord, AuditEntry, ChatMessage, DayNote, FixedEvent, PlannerSnapshot, Proposal, ProposedAction, Task } from '../core/types';
import { fixedEventSchema, timestampSchema, validateActions } from '../core/validation';
import { completionActivity } from '../services/completion';

type Data = Omit<PlannerSnapshot, 'settings'>;
type Entity = Task | FixedEvent | DayNote | ActivityRecord;
type Table = 'tasks' | 'events' | 'activities' | 'days' | 'emails';
interface Change { table: Table; id: string; before: string | null; after: string | null }
interface Batch { id: string; origin: 'manual' | 'ai' | 'calendar'; changes: Change[]; undone: boolean }
const tables = ['tasks', 'events', 'activities', 'days', 'emails', 'history', 'messages', 'proposals', 'batches', 'external_requests'] as const;
const messageSchema = z.object({ id: z.string().min(1), role: z.enum(['user', 'assistant']), content: z.string().min(1).max(100000), createdAt: timestampSchema, proposalId: z.string().min(1).optional() }).strict();
const proposalSchema = z.object({ id: z.string().min(1), message: z.string().min(1).max(100000), actions: z.unknown(), clarification: z.string().optional(), baseRevision: z.number().int().nonnegative(), sourceMessage: z.string(), status: z.enum(['pending', 'applied', 'cancelled']), createdAt: timestampSchema }).strict();

/** Single writer, local SQLite store. All methods after createStore are synchronous. */
export class PlannerStore {
  private closed = false;
  private changes: Map<string, Change> | undefined;
  constructor(private db: Database, private SQL: SqlJsStatic, private filePath: string) {
    const version = Number(this.db.exec('PRAGMA user_version')[0].values[0][0]);
    if (version > 2) throw new Error('This database was created by a newer Matthew Planner version. Update the app before opening it.');
    for (const table of tables) this.db.run(`CREATE TABLE IF NOT EXISTS ${table} (id TEXT PRIMARY KEY, data TEXT NOT NULL)`);
    this.db.run('CREATE TABLE IF NOT EXISTS metadata (key TEXT PRIMARY KEY, value TEXT NOT NULL)');
    this.db.run("INSERT OR IGNORE INTO metadata VALUES ('revision', '0')");
    this.db.run('PRAGMA user_version = 2');
    this.persist();
  }
  private assertOpen() { if (this.closed) throw new Error('Planner store is closed'); }
  private get revision(): number { return Number(this.db.exec("SELECT value FROM metadata WHERE key='revision'")[0].values[0][0]); }
  private bump() { this.db.run("UPDATE metadata SET value = ? WHERE key='revision'", [String(this.revision + 1)]); }
  private all<T>(table: typeof tables[number]): T[] {
    this.assertOpen();
    return (this.db.exec(`SELECT data FROM ${table} ORDER BY rowid`)[0]?.values ?? []).map(row => JSON.parse(String(row[0])) as T);
  }
  private raw(table: typeof tables[number], id: string): string | null {
    const stmt = this.db.prepare(`SELECT data FROM ${table} WHERE id = ?`);
    try { stmt.bind([id]); return stmt.step() ? String(stmt.get()[0]) : null; } finally { stmt.free(); }
  }
  private get<T>(table: typeof tables[number], id: string): T {
    const raw = this.raw(table, id);
    if (!raw) throw new Error(`Unknown ${table === 'tasks' ? 'task' : 'event'}: ${id}`);
    return JSON.parse(raw) as T;
  }
  private write(table: typeof tables[number], id: string, value: unknown) {
    const data = JSON.stringify(value);
    this.track(table, id, data);
    this.db.run(`INSERT INTO ${table} (id,data) VALUES (?,?) ON CONFLICT(id) DO UPDATE SET data=excluded.data`, [id, data]);
  }
  private remove(table: Table, id: string) { this.track(table, id, null); this.db.run(`DELETE FROM ${table} WHERE id=?`, [id]); }
  private track(table: typeof tables[number], id: string, after: string | null) {
    if (!this.changes || !['tasks', 'events', 'activities', 'days', 'emails'].includes(table)) return;
    const key = `${table}:${id}`;
    const previous = this.changes.get(key);
    this.changes.set(key, { table: table as Table, id, before: previous ? previous.before : this.raw(table, id), after });
  }
  private persist() {
    mkdirSync(dirname(this.filePath), { recursive: true });
    const temporary = `${this.filePath}.${randomUUID()}.tmp`;
    let descriptor: number | undefined;
    try {
      descriptor = openSync(temporary, 'wx');
      writeFileSync(descriptor, this.db.export());
      fsyncSync(descriptor); closeSync(descriptor); descriptor = undefined;
      renameSync(temporary, this.filePath);
    } finally {
      if (descriptor !== undefined) closeSync(descriptor);
      if (existsSync(temporary)) unlinkSync(temporary);
    }
  }
  private transaction(operation: () => void) {
    this.assertOpen();
    const previous = this.db.export();
    this.db.run('BEGIN IMMEDIATE');
    try { operation(); this.db.run('COMMIT'); this.persist(); }
    catch (error) { this.db.close(); this.db = new this.SQL.Database(previous); throw error; }
    finally { this.changes = undefined; }
  }
  snapshotData(): Data {
    this.assertOpen();
    return { revision: this.revision, tasks: this.all('tasks'), fixedEvents: this.all('events'), activities: this.all('activities'), dayNotes: this.all('days'), history: this.all('history'), messages: this.all('messages'), proposals: this.all('proposals') };
  }
  private audit(batchId: string, actionType: string, entityId: string, before: Entity | null, after: Entity | null, origin: AuditEntry['origin'], sourceMessage?: string) {
    const entry: AuditEntry = { id: randomUUID(), batchId, actionType, entityId, before, after, timestamp: new Date().toISOString(), origin, undone: false, ...(sourceMessage ? { sourceMessage } : {}) };
    this.write('history', entry.id, entry);
  }
  private batch(origin: Batch['origin'], operation: (batchId: string) => void) {
    const id = randomUUID();
    this.changes = new Map(); operation(id);
    const changes = [...this.changes.values()].filter(change => change.before !== change.after);
    if (changes.length) { this.write('batches', id, { id, origin, changes, undone: false } satisfies Batch); this.bump(); }
  }
  private requireRevision(expected: number) {
    if (!Number.isSafeInteger(expected) || expected !== this.revision) throw new Error('The plan has changed. Refresh and preview the actions again.');
  }
  apply(input: ProposedAction[], expectedRevision: number, origin: 'manual' | 'ai' = 'manual', sourceMessage?: string): Data {
    this.assertOpen();
    const actions = validateActions(input);
    if (origin !== 'manual' && origin !== 'ai') throw new Error('Invalid action origin');
    this.requireRevision(expectedRevision);
    this.transaction(() => this.batch(origin, batchId => { for (const action of actions) this.applyAction(action, batchId, origin, sourceMessage); }));
    return this.snapshotData();
  }
  applyExternal(requestId: string, input: ProposedAction[], expectedRevision: number, sourceMessage: string): { revision: number } {
    z.string().uuid().parse(requestId);
    const actions = validateActions(input);
    z.string().min(1).max(10000).parse(sourceMessage);
    const hash = createHash('sha256').update(JSON.stringify({ actions, expectedRevision, sourceMessage })).digest('hex');
    const previous = this.raw('external_requests', requestId);
    if (previous) {
      const receipt = JSON.parse(previous) as { hash: string; revision: number };
      if (receipt.hash !== hash) throw new Error('This request ID was already used for different changes.');
      return { revision: receipt.revision };
    }
    this.requireRevision(expectedRevision);
    this.transaction(() => {
      this.batch('manual', batchId => { for (const action of actions) this.applyAction(action, batchId, 'manual', sourceMessage); });
      // Receipt and changes commit together. Undo does not erase receipts:
      // retrying a delivered request must never reapply an undone operation.
      this.write('external_requests', requestId, { hash, revision: this.revision });
    });
    return { revision: this.revision };
  }
  applyProposal(id: string): Data {
    this.assertOpen();
    const proposal = this.get<Proposal>('proposals', id);
    if (proposal.status !== 'pending') throw new Error('Proposal is no longer pending');
    this.requireRevision(proposal.baseRevision);
    const actions = validateActions(proposal.actions);
    this.transaction(() => {
      this.batch('ai', batchId => { for (const action of actions) this.applyAction(action, batchId, 'ai', proposal.sourceMessage); });
      this.write('proposals', id, { ...proposal, status: 'applied' });
    });
    return this.snapshotData();
  }
  private addActivity(task: Task, input: ActivityInput, now: string, completionGenerated = false) {
    const activity: ActivityRecord = { ...input, id: randomUUID(), taskId: task.id, createdAt: now, completionGenerated };
    this.write('activities', activity.id, activity);
    this.refreshActivity(task);
  }
  private refreshActivity(task: Task) {
    const records = this.all<ActivityRecord>('activities').filter(record => record.taskId === task.id);
    delete task.actualDurationMinutes; delete task.actualTimeConfidence; delete task.actualStart; delete task.actualEnd;
    if (!records.length) return;
    task.actualDurationMinutes = records.reduce((total, record) => total + record.durationMinutes, 0);
    task.actualTimeConfidence = records.some(record => record.confidence === 'inferred') ? 'inferred' : records.some(record => record.confidence === 'approximate') ? 'approximate' : 'exact';
    const starts = records.flatMap(record => record.startAt ? [record.startAt] : []).sort((a, b) => Date.parse(a) - Date.parse(b));
    const ends = records.flatMap(record => record.endAt ? [record.endAt] : []).sort((a, b) => Date.parse(a) - Date.parse(b));
    if (starts.length) task.actualStart = starts[0];
    if (ends.length) task.actualEnd = ends[ends.length - 1];
  }
  private applyAction(action: ProposedAction, batchId: string, origin: 'manual' | 'ai', sourceMessage?: string) {
    const now = new Date().toISOString();
    if (action.type === 'set_day_note') {
      const before = this.raw('days', action.date) ? this.get<DayNote>('days', action.date) : null;
      const after: DayNote = { id: action.date, text: action.text, updatedAt: now };
      this.write('days', action.date, after); this.audit(batchId, action.type, action.date, before, after, origin, sourceMessage); return;
    }
    if (action.type === 'update_activity') {
      const before = this.get<ActivityRecord>('activities', action.activityId);
      const after = { ...before, ...action.activity };
      const task = this.get<Task>('tasks', before.taskId);
      this.write('activities', after.id, after); this.refreshActivity(task); this.write('tasks', task.id, task);
      this.audit(batchId, action.type, after.id, before, after, origin, sourceMessage); return;
    }
    if (action.type === 'create_completed_task') {
      // No model-generated IDs or forward references. Create and complete in
      // this same validated transaction, reusing the normal completion path.
      const matches = this.all<Task>('tasks').filter(task => task.title.trim().toLocaleLowerCase() === action.task.title.trim().toLocaleLowerCase()
        && task.plannedDate === (action.task.plannedDate ?? action.completedDate) && task.status !== 'cancelled');
      if (matches.length > 1) throw new Error('Several tasks match this completed work. Specify which task.');
      let task = matches[0];
      if (!task) {
        task = { ...action.task, plannedDate: action.task.plannedDate ?? action.completedDate, id: randomUUID(), status: 'planned', priority: action.task.priority ?? 'normal', createdAt: now, updatedAt: now };
        this.write('tasks', task.id, task); this.audit(batchId, 'create_task', task.id, null, task, origin, sourceMessage);
      }
      this.applyAction({ type: 'complete_task', taskId: task.id, completedDate: action.completedDate, activity: action.activity }, batchId, origin, sourceMessage); return;
    }
    if (action.type === 'create_task') {
      const task: Task = { ...action.task, id: randomUUID(), status: action.task.plannedDate ? 'planned' : 'inbox', priority: action.task.priority ?? 'normal', createdAt: now, updatedAt: now };
      this.write('tasks', task.id, task); this.audit(batchId, action.type, task.id, null, task, origin, sourceMessage); return;
    }
    if (action.type === 'create_fixed_event') {
      if (action.event.linkedTaskId) this.get<Task>('tasks', action.event.linkedTaskId);
      const event: FixedEvent = { ...action.event, id: randomUUID(), source: 'local', createdAt: now, updatedAt: now };
      this.write('events', event.id, event); this.audit(batchId, action.type, event.id, null, event, origin, sourceMessage); return;
    }
    if (action.type === 'update_fixed_event' || action.type === 'delete_fixed_event') {
      const before = this.get<FixedEvent>('events', action.eventId);
      if (before.source === 'icloud') throw new Error('Imported calendar events are read-only locally. Edit them in Calendar and sync again.');
      let after: FixedEvent | null = null;
      if (action.type === 'delete_fixed_event') this.remove('events', before.id);
      else {
        after = fixedEventSchema.parse({ ...before, ...action.patch, updatedAt: now });
        if (after.linkedTaskId) this.get<Task>('tasks', after.linkedTaskId);
        this.write('events', before.id, after);
      }
      this.audit(batchId, action.type, before.id, before, after, origin, sourceMessage); return;
    }
    const before = this.get<Task>('tasks', action.taskId);
    const task = { ...before, updatedAt: now };
    switch (action.type) {
      case 'update_task':
        Object.assign(task, action.patch);
        if (task.status === 'inbox' || task.status === 'planned') task.status = task.plannedDate ? 'planned' : 'inbox';
        break;
      case 'complete_task':
        if (task.status === 'completed') return;
        if (task.status === 'cancelled') throw new Error('Only active tasks can be completed');
        { const anchor = new Date(now);
          if (action.completedDate) {
            const [year,month,date] = action.completedDate.split('-').map(Number);
            anchor.setFullYear(year,month - 1,date);
            if (anchor.getTime() > Date.parse(now)) throw new Error('Completion cannot be recorded in the future.');
          }
          task.status = 'completed'; task.completedAt = action.activity?.endAt ?? anchor.toISOString();
          this.addActivity(task, completionActivity(task, this.all('activities'), this.all('events'), anchor, action.activity), now, true);
        } break;
      case 'reopen_task':
        if (task.status !== 'completed') throw new Error('Only completed tasks can be reopened');
        task.status = task.plannedDate ? 'planned' : 'inbox'; delete task.completedAt;
        for (const record of this.all<ActivityRecord>('activities').filter(record => record.taskId === task.id && record.completionGenerated)) this.remove('activities', record.id);
        this.refreshActivity(task); break;
      case 'cancel_task':
        if (task.status === 'completed' || task.status === 'cancelled') throw new Error('Only active tasks can be cancelled');
        task.status = 'cancelled'; task.cancelledAt = now; break;
      case 'move_task': if (task.status === 'completed' || task.status === 'cancelled') throw new Error('Only active tasks can be moved'); task.plannedDate = action.plannedDate; task.status = 'planned'; break;
      case 'change_estimate': task.estimatedDurationMinutes = action.estimatedDurationMinutes; break;
      case 'add_note': task.notes = task.notes ? `${task.notes}\n${action.note}` : action.note; break;
      case 'record_activity': this.addActivity(task, action.activity, now); break;
    }
    this.write('tasks', task.id, task); this.audit(batchId, action.type, task.id, before, task, origin, sourceMessage);
  }
  undo(): Data {
    this.assertOpen();
    const batch = this.all<Batch>('batches').reverse().find(item => item.origin !== 'calendar' && !item.undone);
    if (!batch) throw new Error('There is no local change to undo');
    for (const change of batch.changes) {
      if (this.raw(change.table, change.id) !== change.after) throw new Error('Cannot undo this change because affected data has changed since it was applied.');
      if (change.table === 'events' && change.after && (JSON.parse(change.after) as FixedEvent).source === 'icloud') throw new Error('Published calendar changes must be managed in Calendar. They cannot be undone locally.');
    }
    this.transaction(() => {
      for (const change of batch.changes.slice().reverse()) {
        if (change.before === null) this.remove(change.table, change.id); else this.write(change.table, change.id, JSON.parse(change.before));
      }
      const undoId = randomUUID();
      for (const audit of this.all<AuditEntry>('history').filter(entry => entry.batchId === batch.id && !entry.undone)) {
        this.write('history', audit.id, { ...audit, undone: true });
        this.audit(undoId, `undo:${audit.actionType}`, audit.entityId, audit.after, audit.before, 'undo');
      }
      this.write('batches', batch.id, { ...batch, undone: true }); this.bump();
    });
    return this.snapshotData();
  }
  addMessage(input: ChatMessage): void {
    const message = messageSchema.parse(input);
    this.transaction(() => { if (this.raw('messages', message.id)) throw new Error('Duplicate chat message'); this.write('messages', message.id, message); });
  }
  hasImportedMail(id: string): boolean { return !!this.raw('emails', id); }
  applyMailActions(input: ProposedAction[], expectedRevision: number, ids: string[], sourceMessage: string): Data {
    const actions = input.length ? validateActions(input) : [];
    this.requireRevision(expectedRevision);
    if (!ids.length || new Set(ids).size !== ids.length || ids.some(id => !/^[a-zA-Z0-9_-]{1,256}$/.test(id) || this.hasImportedMail(id))) throw new Error('These emails have already been processed. Refresh the list.');
    this.transaction(() => this.batch('ai', batchId => {
      for (const action of actions) this.applyAction(action, batchId, 'ai', sourceMessage);
      for (const id of ids) { this.write('emails', id, { id, processedAt: new Date().toISOString() }); this.audit(batchId, 'process_email', id, null, null, 'ai', sourceMessage); }
    }));
    return this.snapshotData();
  }
  saveProposal(input: Proposal): void {
    const proposal = proposalSchema.parse(input);
    if (!Array.isArray(proposal.actions)) throw new Error('Invalid proposal actions');
    const actions = proposal.actions.length ? validateActions(proposal.actions) : [];
    this.transaction(() => { if (this.raw('proposals', proposal.id)) throw new Error('Duplicate proposal'); this.write('proposals', proposal.id, { ...proposal, actions }); });
  }
  setProposalStatus(id: string, status: Proposal['status']): void {
    if (status !== 'applied' && status !== 'cancelled') throw new Error('Invalid proposal status');
    this.transaction(() => { const proposal = this.get<Proposal>('proposals', id); if (proposal.status !== 'pending') throw new Error('Proposal is no longer pending'); this.write('proposals', id, { ...proposal, status }); });
  }
  /** Complete snapshot of one calendar. Replaces its imported events, preserving local IDs by externalId. */
  importEvents(input: FixedEvent[], calendarId?: string): Data {
    this.assertOpen();
    const events = z.array(fixedEventSchema).parse(input);
    const selected = calendarId ?? events[0]?.calendarId;
    if (!selected) throw new Error('Calendar ID is required, including when importing an empty calendar');
    if (events.some(event => event.source !== 'icloud' || !event.externalId || (event.calendarId && event.calendarId !== selected))) throw new Error('Calendar import requires external identifiers from the selected calendar');
    if (new Set(events.map(event => event.externalId)).size !== events.length) throw new Error('Duplicate calendar event identifier');
    this.transaction(() => this.batch('calendar', batchId => {
      const previous = this.all<FixedEvent>('events').filter(event => event.source === 'icloud' && event.calendarId === selected);
      const retained = new Set<string>();
      for (const incoming of events) {
        const existing = previous.find(event => event.externalId === incoming.externalId);
        const event: FixedEvent = { ...incoming, calendarId: selected, id: existing?.id ?? incoming.id, createdAt: existing?.createdAt ?? incoming.createdAt, ...(existing?.linkedTaskId ? { linkedTaskId: existing.linkedTaskId } : {}) };
        const collision = this.raw('events', event.id);
        if (collision && !existing) throw new Error('Imported event identifier collides with another calendar or local event');
        retained.add(event.id);
        const meaningful = (value: FixedEvent) => JSON.stringify(Object.entries(value).filter(([key]) => key !== 'createdAt' && key !== 'updatedAt').sort(([a],[b]) => a.localeCompare(b)));
        if (existing && meaningful(existing) === meaningful(event)) continue;
        this.write('events', event.id, event);
        if (!existing || JSON.stringify(existing) !== JSON.stringify(event)) this.audit(batchId, 'import_fixed_event', event.id, existing ?? null, event, 'calendar');
      }
      for (const event of previous) if (!retained.has(event.id)) { this.remove('events', event.id); this.audit(batchId, 'remove_imported_event', event.id, event, null, 'calendar'); }
    }));
    return this.snapshotData();
  }
  /** Main-process metadata acknowledgement after an explicit remote publish succeeds. */
  updatePublishedEvent(eventId: string, metadata: Pick<FixedEvent, 'externalId' | 'calendarProvider' | 'calendarId' | 'etag'>, expectedRevision: number): Data {
    this.assertOpen(); this.requireRevision(expectedRevision);
    const data = z.object({ externalId: z.string().min(1), calendarProvider: z.string().min(1), calendarId: z.string().min(1), etag: z.string().optional() }).strict().parse(metadata);
    this.transaction(() => this.batch('calendar', batchId => {
      const before = this.get<FixedEvent>('events', eventId);
      const after: FixedEvent = { ...before, ...data, source: 'icloud', updatedAt: new Date().toISOString() };
      this.write('events', eventId, after); this.audit(batchId, 'publish_fixed_event', eventId, before, after, 'calendar');
    }));
    return this.snapshotData();
  }
  close(): void { if (!this.closed) { this.db.close(); this.closed = true; } }
}

export async function createStore(filePath: string, wasmPath?: string): Promise<PlannerStore> {
  const SQL = await initSqlJs(wasmPath ? { locateFile: () => wasmPath } : undefined);
  const db = existsSync(filePath) ? new SQL.Database(readFileSync(filePath)) : new SQL.Database();
  const version = Number(db.exec('PRAGMA user_version')[0].values[0][0]);
  if (version === 1 && !existsSync(`${filePath}.pre-v2.bak`)) writeFileSync(`${filePath}.pre-v2.bak`, readFileSync(filePath), { flag: 'wx' });
  try { return new PlannerStore(db, SQL, filePath); } catch (error) { db.close(); throw error; }
}
