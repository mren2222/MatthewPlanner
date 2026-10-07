import { afterEach, describe, expect, it } from 'vitest';
import { mkdtempSync, readFileSync, rmSync, renameSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import initSqlJs from 'sql.js';
import { createStore, type PlannerStore } from '../src/db/store';
import { validateActions } from '../src/core/validation';
import type { FixedEvent } from '../src/core/types';

const directories: string[] = [];
const stores: PlannerStore[] = [];
async function setup() {
  const directory = mkdtempSync(join(tmpdir(), 'matthew-planner-data-')); directories.push(directory);
  const path = join(directory, 'planner.sqlite');
  const store = await createStore(path); stores.push(store);
  return { store, path };
}
afterEach(() => { for (const store of stores.splice(0)) store.close(); for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true }); });
const event = (externalId: string, calendarId = 'primary'): FixedEvent => ({
  id: `incoming-${externalId}`, title: 'Appointment', startAt: '2026-10-07T10:00:00-07:00', endAt: '2026-10-07T11:00:00-07:00', timezone: 'America/Los_Angeles', source: 'icloud', externalId, calendarId, calendarProvider: 'icloud', createdAt: '2026-10-07T00:00:00Z', updatedAt: '2026-10-07T00:00:00Z',
});

describe('strict action boundary', () => {
  it('rejects timing fields on flexible tasks, identifiers in patches and invalid dates', () => {
    expect(() => validateActions([{ type: 'create_task', task: { title: 'Read', plannedDate: '2026-02-30' } }])).toThrow();
    expect(() => validateActions([{ type: 'create_task', task: { title: 'Read', startAt: '2026-10-07T10:00:00Z' } }])).toThrow();
    expect(() => validateActions([{ type: 'update_task', taskId: 'x', patch: { id: 'other' } }])).toThrow();
    expect(() => validateActions([{ type: 'change_estimate', taskId: 'x', estimatedDurationMinutes: -10 }])).toThrow();
    expect(() => validateActions([{ type: 'create_fixed_event', event: { title: 'Meet', startAt: '2026-10-07T25:00:00Z', endAt: '2026-10-07T26:00:00Z', timezone: 'UTC' } }])).toThrow();
    expect(() => validateActions([{ type: 'create_fixed_event', event: { title: 'Meet', startAt: '2026-10-07T10:00:00Z', endAt: '2026-10-07T09:00:00Z', timezone: 'UTC' } }])).toThrow();
  });
});

describe('persistent action transactions', () => {
  it('does not change revision or audit history on an unchanged periodic calendar refresh', async () => {
    const {store}=await setup();store.importEvents([event('same')],'primary');const before=store.snapshotData();
    store.importEvents([{...event('same'),createdAt:'2026-10-07T01:00:00Z',updatedAt:'2026-10-07T01:00:00Z'}],'primary');expect(store.snapshotData()).toEqual(before);
  });
  it('persists SQLite tasks, messages, proposals, revision and before/after audits across restart', async () => {
    const { store, path } = await setup();
    store.apply([{ type: 'create_task', task: { title: 'Read', plannedDate: '2026-10-07', estimatedDurationMinutes: 30 } }], 0, 'manual');
    const id = store.snapshotData().tasks[0].id;
    store.addMessage({ id: 'message', role: 'user', content: 'Move reading', createdAt: '2026-10-07T10:00:00Z' });
    store.saveProposal({ id: 'proposal', message: 'Move reading', actions: [{ type: 'move_task', taskId: id, plannedDate: '2026-10-08' }], baseRevision: 1, sourceMessage: 'Move reading', status: 'pending', createdAt: '2026-10-07T10:00:00Z' });
    store.apply([{ type: 'move_task', taskId: id, plannedDate: '2026-10-08' }], 1, 'ai', 'Move reading');
    store.setProposalStatus('proposal', 'applied');
    const expected = store.snapshotData(); store.close();
    expect(readFileSync(path).subarray(0, 16).toString()).toBe('SQLite format 3\u0000');
    const reopened = await createStore(path); stores.push(reopened);
    expect(reopened.snapshotData()).toEqual(expected);
    expect(expected.history[1]).toMatchObject({ before: { plannedDate: '2026-10-07' }, after: { plannedDate: '2026-10-08' }, origin: 'ai', sourceMessage: 'Move reading' });
    expect(Object.hasOwn(expected.tasks[0], 'startAt')).toBe(false);
  });

  it('rolls back every mutation and audit if a later action fails', async () => {
    const { store, path } = await setup(); const before = store.snapshotData(); const disk = readFileSync(path);
    expect(() => store.apply([{ type: 'create_task', task: { title: 'Partial' } }, { type: 'move_task', taskId: 'missing', plannedDate: '2026-10-07' }], 0, 'manual')).toThrow('Unknown task');
    expect(store.snapshotData()).toEqual(before); expect(readFileSync(path)).toEqual(disk);
  });

  it('does not report success or retain memory mutations when atomic persistence fails', async () => {
    const { store, path } = await setup(); const backup = `${path}.previous`; renameSync(path, backup); mkdirSync(path);
    expect(() => store.apply([{ type: 'create_task', task: { title: 'Fail safely' } }], 0, 'manual')).toThrow();
    expect(store.snapshotData().tasks).toEqual([]); expect(store.snapshotData().revision).toBe(0);
    rmSync(path, { recursive: true }); renameSync(backup, path);
    store.apply([{ type: 'create_task', task: { title: 'Next attempt' } }], 0, 'manual');
    expect(store.snapshotData().tasks[0].title).toBe('Next attempt');
  });

  it('rejects stale revisions before writing anything', async () => {
    const { store } = await setup(); store.apply([{ type: 'create_task', task: { title: 'Read' } }], 0, 'manual');
    expect(() => store.apply([{ type: 'create_task', task: { title: 'Stale' } }], 0, 'ai')).toThrow('plan has changed');
    expect(store.snapshotData().tasks).toHaveLength(1);
  });

  it('undoes completion and its activity, supports consecutive undo and persists undo history', async () => {
    const { store, path } = await setup(); store.apply([{ type: 'create_task', task: { title: 'Read' } }], 0, 'manual');
    const id = store.snapshotData().tasks[0].id;
    store.apply([{ type: 'complete_task', taskId: id, activity: { durationMinutes: 25, confidence: 'approximate', source: 'manual' } }], 1, 'manual');
    expect(store.snapshotData().activities).toHaveLength(1);
    store.undo(); expect(store.snapshotData().tasks[0].status).toBe('inbox'); expect(store.snapshotData().activities).toEqual([]);
    const reopened = await createStore(path); stores.push(reopened); store.close();
    expect(reopened.snapshotData().history.filter(entry => entry.origin === 'undo')).toHaveLength(1);
    reopened.undo(); expect(reopened.snapshotData().tasks).toEqual([]); expect(reopened.snapshotData().revision).toBe(4);
    expect(() => reopened.undo()).toThrow('no local change');
  });

  it('validates merged fixed event patches and rolls invalid partial updates back', async () => {
    const { store } = await setup(); store.apply([{ type: 'create_fixed_event', event: { title: 'Meeting', startAt: '2026-10-07T10:00:00Z', endAt: '2026-10-07T11:00:00Z', timezone: 'UTC' } }], 0, 'manual');
    const before = store.snapshotData();
    expect(() => store.apply([{ type: 'update_fixed_event', eventId: before.fixedEvents[0].id, patch: { startAt: '2026-10-07T12:00:00Z' } }], 1, 'manual')).toThrow();
    expect(store.snapshotData()).toEqual(before);
  });

  it('applies proposal actions and status atomically, rejecting stale and duplicate applications', async () => {
    const { store, path } = await setup();
    store.saveProposal({ id: 'bad', message: 'Create then fail', actions: [{ type: 'create_task', task: { title: 'Partial' } }, { type: 'complete_task', taskId: 'missing' }], baseRevision: 0, sourceMessage: 'request', status: 'pending', createdAt: '2026-10-07T10:00:00Z' });
    expect(() => store.applyProposal('bad')).toThrow();
    expect(store.snapshotData().tasks).toEqual([]); expect(store.snapshotData().proposals[0].status).toBe('pending');
    store.saveProposal({ id: 'good', message: 'Create reading', actions: [{ type: 'create_task', task: { title: 'Reading' } }], baseRevision: 0, sourceMessage: 'request', status: 'pending', createdAt: '2026-10-07T10:00:00Z' });
    store.applyProposal('good');
    expect(() => store.applyProposal('good')).toThrow('no longer pending');
    expect(() => store.applyProposal('bad')).toThrow('plan has changed');
    store.close(); const reopened = await createStore(path); stores.push(reopened);
    expect(reopened.snapshotData().tasks[0].title).toBe('Reading');
    expect(reopened.snapshotData().proposals.find(item => item.id === 'good')?.status).toBe('applied');
    expect(reopened.snapshotData().history[0].origin).toBe('ai');
  });

  it('clears optional fields consistently but rejects clearing required task fields', async () => {
    const { store } = await setup();
    store.apply([{ type: 'create_task', task: { title: 'Read', projectId: 'Personal', plannedDate: '2026-10-07' } }], 0, 'manual');
    const id = store.snapshotData().tasks[0].id;
    store.apply([{ type: 'update_task', taskId: id, patch: { projectId: undefined, plannedDate: undefined } }], 1, 'manual');
    expect(store.snapshotData().tasks[0]).toMatchObject({ title: 'Read', status: 'inbox' });
    expect(Object.hasOwn(store.snapshotData().tasks[0], 'projectId')).toBe(false);
    expect(() => validateActions([{ type: 'update_task', taskId: id, patch: { title: undefined } }])).toThrow('cannot be cleared');
  });

  it('records a schema version and rejects newer databases without changing their bytes', async () => {
    const { store, path } = await setup(); store.close();
    const SQL = await initSqlJs(); const db = new SQL.Database(readFileSync(path));
    expect(db.exec('PRAGMA user_version')[0].values[0][0]).toBe(2);
    db.run('PRAGMA user_version = 3');
    const { writeFileSync } = await import('node:fs'); writeFileSync(path, db.export()); db.close();
    const previous = readFileSync(path);
    await expect(createStore(path)).rejects.toThrow('newer Matthew Planner version');
    expect(readFileSync(path)).toEqual(previous);
  });
});

describe('calendar isolation', () => {
  it('imports complete selected calendars without mutating flexible tasks or other calendars', async () => {
    const { store } = await setup(); store.apply([{ type: 'create_task', task: { title: 'Reading', plannedDate: '2026-10-07', estimatedDurationMinutes: 30 } }], 0, 'manual');
    const task = store.snapshotData().tasks[0];
    store.importEvents([event('one')], 'primary'); store.importEvents([event('two', 'secondary')], 'secondary');
    store.importEvents([], 'primary');
    expect(store.snapshotData().tasks).toEqual([task]); expect(store.snapshotData().fixedEvents.map(item => item.externalId)).toEqual(['two']);
    store.undo(); expect(store.snapshotData().tasks).toEqual([]); expect(store.snapshotData().fixedEvents).toHaveLength(1);
  });

  it('preserves published local IDs and blocks undo after external publication', async () => {
    const { store } = await setup(); store.apply([{ type: 'create_fixed_event', event: { title: 'Meeting', startAt: '2026-10-07T10:00:00Z', endAt: '2026-10-07T11:00:00Z', timezone: 'UTC' } }], 0, 'manual');
    const id = store.snapshotData().fixedEvents[0].id;
    store.updatePublishedEvent(id, { externalId: 'remote', calendarProvider: 'icloud', calendarId: 'primary' }, 1);
    store.importEvents([event('remote')], 'primary');
    expect(store.snapshotData().fixedEvents[0].id).toBe(id);
    expect(() => store.undo()).toThrow('affected data has changed');
    expect(() => store.apply([{ type: 'delete_fixed_event', eventId: id }], store.snapshotData().revision, 'manual')).toThrow('read-only');
  });
});
