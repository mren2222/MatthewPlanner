import { afterEach, describe, expect, it } from 'vitest';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { createStore, type PlannerStore } from '../src/db/store';
import { ActionService } from '../src/services/actions';
import { LocalPlannerBridge } from '../src/services/local-bridge';
import type { ProposedAction } from '../src/core/types';

const folders:string[]=[], stores:PlannerStore[]=[];
afterEach(()=>{stores.splice(0).forEach(store=>store.close());folders.splice(0).forEach(folder=>rmSync(folder,{recursive:true,force:true}));});
async function setup() {
  const directory=mkdtempSync(join(tmpdir(),'planner-bridge-'));folders.push(directory);
  const path=join(directory,'planner.sqlite'),store=await createStore(path);stores.push(store);
  const service=new ActionService(store),bridge=new LocalPlannerBridge(directory,()=>({revision:store.snapshotData().revision,tasks:store.snapshotData().tasks}),
    request=>service.applyExternal(request.id,request.actions as ProposedAction[],request.expectedRevision,request.sourceMessage),()=> 'Request rejected');
  const request=(id:string,actions:unknown,expectedRevision=0)=>writeFileSync(join(directory,'incoming',`${id}.json`),JSON.stringify({id,actions,expectedRevision,sourceMessage:'用户：准备面试'}));
  const result=(id:string)=>JSON.parse(readFileSync(join(directory,'results',`${id}.json`),'utf8'));
  return {directory,path,store,bridge,request,result};
}
describe('local Codex/Work bridge',()=>{
  it('delivers validated audited changes, publishes a snapshot and supports UI undo',async()=>{
    const {store,bridge,request,result,directory}=await setup(),id=randomUUID();
    request(id,[{type:'create_task',task:{title:'准备面试',plannedDate:'2026-10-08',estimatedDurationMinutes:60}}]);bridge.process();
    expect(result(id)).toMatchObject({id,status:'applied',revision:1});expect(result(id).requestHash).toMatch(/^[0-9a-f]{64}$/);
    expect(store.snapshotData().history[0]).toMatchObject({origin:'manual',sourceMessage:'用户：准备面试'});
    const snapshot=JSON.parse(readFileSync(join(directory,'snapshot.json'),'utf8'));expect(snapshot.tasks[0].title).toBe('准备面试');expect(snapshot.settings).toBeUndefined();
    store.undo();expect(store.snapshotData().tasks).toEqual([]);
  });
  it('never repeats a delivered request, including after restart and undo',async()=>{
    const {store,path,bridge,request,result}=await setup(),id=randomUUID(),actions:ProposedAction[]=[{type:'create_task',task:{title:'Resume'}}];
    request(id,actions);bridge.process();const completed=store.snapshotData();
    request(id,actions);bridge.process();expect(store.snapshotData()).toEqual(completed);
    store.undo();request(id,actions);bridge.process();expect(result(id).status).toBe('applied');expect(store.snapshotData().tasks).toEqual([]);
    store.close();const reopened=await createStore(path);stores.push(reopened);
    expect(reopened.applyExternal(id,actions,0,'用户：准备面试')).toEqual({revision:1});expect(reopened.snapshotData().tasks).toEqual([]);
  });
  it('rejects changed payloads under a reused ID and stale revisions',async()=>{
    const {store,bridge,request,result}=await setup(),id=randomUUID();request(id,[{type:'create_task',task:{title:'A'}}]);bridge.process();const before=store.snapshotData();
    request(id,[{type:'create_task',task:{title:'B'}}]);bridge.process();expect(result(id).status).toBe('error');expect(store.snapshotData()).toEqual(before);
    const stale=randomUUID();request(stale,[{type:'create_task',task:{title:'C'}}]);bridge.process();expect(result(stale).status).toBe('error');expect(store.snapshotData()).toEqual(before);
  });
  it('rejects invalid actions atomically and allows a failed request to be corrected',async()=>{
    const {store,bridge,request,result}=await setup(),id=randomUUID();
    request(id,[{type:'create_task',task:{title:'A'}},{type:'complete_task',taskId:'missing'}]);bridge.process();expect(result(id).status).toBe('error');expect(store.snapshotData().tasks).toEqual([]);
    request(id,[{type:'create_task',task:{title:'A'}}]);bridge.process();expect(result(id).status).toBe('applied');expect(store.snapshotData().tasks).toHaveLength(1);
  });
  it('rejects arbitrary scheduling fields and malformed or oversized request files',async()=>{
    const {store,bridge,request,result,directory}=await setup();
    const ids=[randomUUID(),randomUUID(),randomUUID()];request(ids[0],[{type:'create_task',task:{title:'A',startAt:'10:00'}}]);
    writeFileSync(join(directory,'incoming',`${ids[1]}.json`),'not JSON');writeFileSync(join(directory,'incoming',`${ids[2]}.json`),'x'.repeat(200001));bridge.process();
    for(const id of ids)expect(result(id).status).toBe('error');expect(store.snapshotData().tasks).toEqual([]);
  });
  it('keeps completion local and rejects edits to imported iCloud events',async()=>{
    const {store,bridge,request,result}=await setup();
    store.importEvents([{id:'cloud',externalId:'external',calendarId:'things',title:'Meeting',startAt:'2026-10-09T11:00:00-07:00',endAt:'2026-10-09T11:30:00-07:00',timezone:'America/Los_Angeles',source:'icloud',createdAt:'2026-10-07T00:00:00Z',updatedAt:'2026-10-07T00:00:00Z'}],'things');
    const id=randomUUID();request(id,[{type:'create_completed_task',task:{title:'DRI 面试'},completedDate:'2000-01-02'}],1);bridge.process();expect(result(id).status).toBe('applied');expect(store.snapshotData().fixedEvents).toHaveLength(1);
    const blocked=randomUUID(),before=store.snapshotData();request(blocked,[{type:'delete_fixed_event',eventId:'cloud'}],before.revision);bridge.process();expect(result(blocked).status).toBe('error');expect(store.snapshotData()).toEqual(before);
  });
});
