import { afterEach, describe, expect, it } from 'vitest';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import initSqlJs from 'sql.js';
import { createStore, type PlannerStore } from '../src/db/store';
import { completionActivity } from '../src/services/completion';
import { directReply, isDiscussion } from '../src/services/chat-policy';
import { layoutBlocks } from '../src/ui/calendar-layout';
import type { ActivityRecord, Task } from '../src/core/types';

const folders: string[] = [], stores: PlannerStore[] = [];
async function setup() { const folder = mkdtempSync(join(tmpdir(), 'planner-redesign-')); folders.push(folder); const path = join(folder, 'planner.sqlite'); const store = await createStore(path); stores.push(store); return { store,path }; }
afterEach(() => { stores.splice(0).forEach(store => store.close()); folders.splice(0).forEach(folder => rmSync(folder,{recursive:true,force:true})); });
const task: Task = { id:'t',title:'Resume',status:'planned',priority:'normal',estimatedDurationMinutes:60,createdAt:'2026-10-07T00:00:00Z',updatedAt:'2026-10-07T00:00:00Z' };
describe('local completion history', () => {
  it('creates missing completed work atomically, deduplicates repeats, persists and undoes both task and history', async () => {
    const {store,path}=await setup();
    const action = {type:'create_completed_task' as const,task:{title:'DRI 面试'},completedDate:'2000-01-02'};
    store.apply([action],0,'ai','DRI面试很顺利');
    const completed=store.snapshotData();
    expect(completed.tasks).toHaveLength(1);expect(completed.tasks[0]).toMatchObject({status:'completed',plannedDate:'2000-01-02'});
    expect(completed.activities).toHaveLength(1);expect(completed.fixedEvents).toEqual([]);
    expect(completed.history.map(entry=>entry.actionType)).toEqual(['create_task','complete_task']);
    store.apply([action],completed.revision);expect(store.snapshotData()).toEqual(completed);
    store.close();const reopened=await createStore(path);stores.push(reopened);expect(reopened.snapshotData()).toEqual(completed);
    reopened.undo();expect(reopened.snapshotData().tasks).toEqual([]);expect(reopened.snapshotData().activities).toEqual([]);
  });
  it('rolls back creation if a completion date is invalid and reuses an existing matching active task',async()=>{
    const {store}=await setup();const before=store.snapshotData();
    expect(()=>store.apply([{type:'create_completed_task',task:{title:'Future'},completedDate:'2999-01-01'}],0)).toThrow('future');expect(store.snapshotData()).toEqual(before);
    store.apply([{type:'create_task',task:{title:'DRI 面试',plannedDate:'2000-01-02'}}],0);
    const id=store.snapshotData().tasks[0].id;
    store.apply([{type:'create_completed_task',task:{title:'DRI 面试'},completedDate:'2000-01-02'}],1);
    expect(store.snapshotData().tasks).toHaveLength(1);expect(store.snapshotData().tasks[0].id).toBe(id);
    store.undo();expect(store.snapshotData().tasks[0].status).toBe('planned');expect(store.snapshotData().activities).toEqual([]);
  });
  it('places retrospective intervals outside existing history and keeps source information', () => {
    const record: ActivityRecord = { id:'r',taskId:'other',startAt:'2026-10-07T10:30:00Z',endAt:'2026-10-07T11:30:00Z',durationMinutes:60,confidence:'exact',source:'manual',createdAt:'2026-10-07T11:30:00Z' };
    expect(completionActivity(task,[record],[],new Date('2026-10-07T12:00:00Z'))).toMatchObject({ startAt:'2026-10-07T09:30:00.000Z',endAt:'2026-10-07T10:30:00.000Z',confidence:'inferred',source:'ai_inferred' });
    const explicit = { startAt:'2026-10-07T10:00:00Z',endAt:'2026-10-07T12:00:00Z',durationMinutes:120,confidence:'exact' as const,source:'manual' as const };
    expect(completionActivity(task,[record],[],new Date('2026-10-07T12:00:00Z'),explicit)).toEqual(explicit);
  });
  it('uses a default block when no duration is supplied, without adding scheduled fields', () => {
    const placed = completionActivity({...task,estimatedDurationMinutes:undefined},[],[],new Date('2026-10-07T12:00:00Z'));
    expect(placed.durationMinutes).toBe(30); expect(placed.endAt).toBe('2026-10-07T12:00:00.000Z'); expect(task).not.toHaveProperty('startAt');
  });
  it('does not push completion into a different day because of an all-day commitment',()=>{
    const placed=completionActivity(task,[],[{id:'all',title:'All day',startAt:'2026-10-07T00:00:00Z',endAt:'2026-10-08T00:00:00Z',allDay:true,timezone:'UTC',source:'local',createdAt:'2026-10-07T00:00:00Z',updatedAt:'2026-10-07T00:00:00Z'}],new Date('2026-10-07T12:00:00Z'));
    expect(placed.startAt).toBe('2026-10-07T11:00:00.000Z');
  });
  it('completes once, restores activity on undo, and persists reopen independently of other activity', async () => {
    const { store,path } = await setup();
    store.apply([{type:'create_task',task:{title:'Resume',plannedDate:'2026-10-07',estimatedDurationMinutes:60}}],0);
    const id = store.snapshotData().tasks[0].id;
    store.apply([{type:'record_activity',taskId:id,activity:{durationMinutes:15,confidence:'exact',source:'manual'}}],1);
    store.apply([{type:'complete_task',taskId:id}],2);
    const completed = store.snapshotData(); expect(completed.activities).toHaveLength(2); expect(completed.fixedEvents).toEqual([]);
    store.apply([{type:'complete_task',taskId:id}],completed.revision); expect(store.snapshotData()).toEqual(completed);
    store.apply([{type:'reopen_task',taskId:id}],completed.revision); expect(store.snapshotData().activities).toHaveLength(1); expect(store.snapshotData().tasks[0].actualDurationMinutes).toBe(15);
    store.undo(); expect(store.snapshotData().tasks[0].status).toBe('completed'); expect(store.snapshotData().activities).toEqual(completed.activities);
    const expected = store.snapshotData(); store.close(); const reopened = await createStore(path); stores.push(reopened); expect(reopened.snapshotData()).toEqual(expected);
  });
  it('records a historical completion day and rejects future completion atomically', async () => {
    const {store} = await setup(); store.apply([{type:'create_task',task:{title:'Resume'}}],0); const id=store.snapshotData().tasks[0].id;
    const before=store.snapshotData(); expect(()=>store.apply([{type:'complete_task',taskId:id,completedDate:'2999-01-01'}],before.revision)).toThrow('future'); expect(store.snapshotData()).toEqual(before);
    store.apply([{type:'complete_task',taskId:id,completedDate:'2000-01-02'}],before.revision); expect(new Date(store.snapshotData().tasks[0].completedAt!).getFullYear()).toBe(2000);
  });
  it('edits history and notes through audited, reversible transactions', async () => {
    const {store}=await setup();store.apply([{type:'create_task',task:{title:'Resume'}}],0);const id=store.snapshotData().tasks[0].id;
    store.apply([{type:'complete_task',taskId:id}],1); const activity=store.snapshotData().activities[0];
    store.apply([{type:'update_activity',activityId:activity.id,activity:{startAt:'2026-10-07T14:00:00Z',endAt:'2026-10-07T16:00:00Z',durationMinutes:120,confidence:'approximate',source:'manual'}},{type:'set_day_note',date:'2026-10-07',text:'Submitted application'}],2);
    expect(store.snapshotData().dayNotes[0].text).toBe('Submitted application'); expect(store.snapshotData().tasks[0].actualDurationMinutes).toBe(120);
    store.undo(); expect(store.snapshotData().dayNotes).toEqual([]); expect(store.snapshotData().activities[0]).toEqual(activity);
  });
  it('atomically remembers processed email IDs, deduplicates, and clears them on undo', async () => {
    const {store,path}=await setup();store.applyMailActions([{type:'create_task',task:{title:'Email preparation'}}],0,['mail1'],'Selected email');
    expect(store.hasImportedMail('mail1')).toBe(true);const before=store.snapshotData();expect(()=>store.applyMailActions([{type:'create_task',task:{title:'Duplicate'}}],before.revision,['mail1'],'Selected email')).toThrow('already');expect(store.snapshotData()).toEqual(before);
    store.undo();expect(store.hasImportedMail('mail1')).toBe(false);expect(store.snapshotData().tasks).toEqual([]);
    store.applyMailActions([{type:'create_task',task:{title:'Email preparation'}}],store.snapshotData().revision,['mail1'],'Selected email');store.close();const reopened=await createStore(path);stores.push(reopened);expect(reopened.hasImportedMail('mail1')).toBe(true);
  });
  it('upgrades a version 1 database without losing task rows', async () => {
    const {store,path}=await setup();store.apply([{type:'create_task',task:{title:'Existing task'}}],0);store.close();
    const SQL=await initSqlJs();const db=new SQL.Database(readFileSync(path));db.run('PRAGMA user_version=1');db.run('DROP TABLE days');db.run('DROP TABLE emails');const {writeFileSync}=await import('node:fs');writeFileSync(path,db.export());db.close();
    const upgraded=await createStore(path);stores.push(upgraded);expect(upgraded.snapshotData().tasks[0].title).toBe('Existing task');expect(upgraded.snapshotData().dayNotes).toEqual([]);
  });
});
describe('direct chat policy',()=>{
  it.each(['先讨论一下，今天加一个任务怎么样','不要修改计划','Let us discuss moving Portfolio tomorrow'])('keeps discussion read-only: %s',message=>{expect(isDiscussion(message)).toBe(true);expect(directReply({message:'ok',actions:[{type:'create_task',task:{title:'Example'}}]},isDiscussion(message)).actions).toEqual([]);});
  it('applies clear commands but suppresses an ambiguous batch',()=>{const actions=[{type:'complete_task' as const,taskId:'t'}];expect(isDiscussion('我完成了 Resume')).toBe(false);expect(directReply({message:'ok',actions},false).actions).toEqual(actions);expect(directReply({message:'ok',actions,clarification:'Which one?'},false).actions).toEqual([]);});
});
describe('calendar overlap layout',()=>{
  it('gives overlapping blocks lanes and restores full width to independent groups',()=>{
    const blocks=layoutBlocks([{id:'a',start:0,end:60},{id:'b',start:30,end:80},{id:'c',start:60,end:90},{id:'d',start:100,end:120}]);
    expect(blocks.map(block=>[block.lane,block.lanes])).toEqual([[0,2],[1,2],[0,2],[0,1]]);
  });
});
