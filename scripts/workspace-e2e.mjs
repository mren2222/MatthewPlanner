import { _electron as electron, expect } from '@playwright/test';
import electronPath from 'electron';
import { mkdtemp, mkdir, readFile, writeFile } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { randomUUID } from 'node:crypto';
import { resolve } from 'node:path';
import assert from 'node:assert/strict';

await mkdir('test-results',{recursive:true});
const dataDir=await mkdtemp(resolve('test-results/desktop-v2-'));
const env={...process.env,PLANNER_E2E:'1',PLANNER_DATA_DIR:dataDir};
delete env.ELECTRON_RUN_AS_NODE;delete env.OPENAI_API_KEY;delete env.PLANNER_DEV_URL;
let app;
const packaged=process.argv.includes('--packaged');
async function launch(){
  app=await electron.launch({executablePath:packaged?resolve('release/win-unpacked/Matthew Planner.exe'):electronPath,args:packaged?[]:[resolve('.')],env,timeout:30000});
  const page=await app.firstWindow();page.setDefaultTimeout(12000);await expect(page.getByTestId('new-task')).toBeVisible();return page;
}
const state=page=>page.evaluate(()=>window.planner.snapshot());
const ready=page=>expect(page.getByTestId('new-task')).toBeEnabled();
async function createTask(page,title,minutes){
  await page.getByTestId('new-task').click();await page.getByTestId('task-title').fill(title);
  if(minutes!==undefined)await page.getByTestId('task-duration').fill(String(minutes));
  await page.getByRole('button',{name:'保存任务',exact:true}).click();await expect(page.getByRole('dialog')).toHaveCount(0);await ready(page);
}
async function chat(page,text){await page.getByTestId('chat-input').fill(text);await page.getByRole('button',{name:'发送消息',exact:true}).click();await ready(page);}
try{
  let page=await launch();const errors=[];page.on('pageerror',error=>errors.push(error.message));
  assert.equal(await page.evaluate(()=>typeof window.require),'undefined');
  assert.equal((await state(page)).settings.aiModel,'gpt-5.6-luna');
  await expect(page.getByTestId('chat-input')).toHaveCount(0);
  // Real local Work/Codex delivery through the CLI, Electron inbox, validated
  // ActionService and persistent receipt; never through direct SQLite writes.
  const bridgeDir=resolve(dataDir,'bridge'),exec=promisify(execFile);
  const initial=JSON.parse((await exec(process.execPath,['scripts/planner.mjs','snapshot','--bridge-dir',bridgeDir])).stdout);
  assert.equal(initial.settings,undefined);
  const requestPath=resolve(dataDir,'work-request.json');
  await writeFile(requestPath,JSON.stringify({id:randomUUID(),expectedRevision:initial.revision,sourceMessage:'Work：DRI面试已完成',actions:[{type:'create_completed_task',task:{title:'DRI 面试记录'},completedDate:'2000-01-02'}]}));
  const delivered=JSON.parse((await exec(process.execPath,['scripts/planner.mjs','apply','--file',requestPath,'--bridge-dir',bridgeDir])).stdout);
  assert.equal(delivered.status,'applied');
  const deliveredState=await state(page);assert.equal(deliveredState.tasks[0].status,'completed');assert.equal(deliveredState.activities.length,1);assert.equal(deliveredState.fixedEvents.length,0);
  await exec(process.execPath,['scripts/planner.mjs','apply','--file',requestPath,'--bridge-dir',bridgeDir]);
  assert.deepEqual((await state(page)).tasks,deliveredState.tasks);
  await page.evaluate(()=>window.planner.undo());await page.reload();await ready(page);
  const undoneState=await state(page);assert.equal(undoneState.tasks.length,0);assert.equal(undoneState.activities.length,0);
  await createTask(page,'Portfolio',60);await createTask(page,'DRI follow-up',30);await createTask(page,'整理联系人');
  assert.equal((await state(page)).tasks.find(task=>task.title==='整理联系人').estimatedDurationMinutes,undefined);
  await expect(page.getByTestId('week-overview')).not.toContainText('Portfolio');
  await expect(page.locator('.stats')).toHaveCount(0);
  const beforeChat=await state(page);
  await page.getByRole('button',{name:'打开对话',exact:true}).click();
  assert.equal(await page.getByTestId('chat-input').evaluate(input=>Math.round(input.getBoundingClientRect().height)),126);
  await chat(page,'portfolio今天不做了，明天吧');
  let snap=await state(page);assert.notEqual(snap.tasks.find(task=>task.title==='Portfolio').plannedDate,beforeChat.tasks.find(task=>task.title==='Portfolio').plannedDate);
  assert.equal(snap.proposals.at(-1).status,'applied');assert.equal(snap.fixedEvents.length,0);
  assert.equal(snap.proposals.filter(proposal=>proposal.status==='pending').length,0);
  const discussed=await state(page);await chat(page,'先讨论一下，DRI follow-up完成了');assert.deepEqual((await state(page)).tasks,discussed.tasks);
  await page.getByRole('button',{name:'收起对话',exact:true}).click();
  await page.getByRole('button',{name:'完成 DRI follow-up',exact:true}).click();await ready(page);
  await expect(page.getByRole('dialog')).toHaveCount(0);snap=await state(page);assert.equal(snap.activities.length,1);assert.equal(snap.activities[0].confidence,'inferred');assert.equal(snap.activities[0].durationMinutes,30);
  await page.getByRole('button',{name:'恢复 DRI follow-up',exact:true}).click();await ready(page);assert.equal((await state(page)).activities.length,0);
  await page.getByRole('button',{name:'撤销',exact:true}).click();await ready(page);assert.equal((await state(page)).activities.length,1);
  await page.getByRole('button',{name:'打开对话',exact:true}).click();await chat(page,'DRI follow-up done');assert.equal((await state(page)).activities.length,1);
  await page.getByRole('button',{name:'收起对话',exact:true}).click();
  await page.getByRole('button',{name:'＋ 添加',exact:true}).click();await page.getByLabel('安排名称').fill('今日面试');await page.getByLabel('地点或会议链接').fill('https://teams.microsoft.com/example');await page.getByRole('button',{name:'保存安排',exact:true}).click();await expect(page.getByRole('dialog')).toHaveCount(0);
  snap=await state(page);const today=beforeChat.tasks[0].plannedDate;const next=snap.tasks.find(task=>task.title==='Portfolio').plannedDate;
  await page.evaluate(async({next})=>{const state=await window.planner.snapshot();await window.planner.apply([{type:'create_fixed_event',event:{title:'明日电话面试',startAt:new Date(`${next}T10:00:00`).toISOString(),endAt:new Date(`${next}T11:00:00`).toISOString(),timezone:Intl.DateTimeFormat().resolvedOptions().timeZone}}],state.revision);},{next});
  await page.getByRole('button',{name:'刷新',exact:true}).isDisabled();
  await page.reload();await expect(page.locator('.next-day')).toContainText('明日电话面试');await expect(page.locator('.selected-day .event-time').first()).toHaveText('09:00');
  await expect(page.getByTestId('week-overview')).not.toContainText('整理联系人');
  await page.getByLabel('每日 Notes').fill('简历已提交，滑雪邮件保留两家。');await page.getByRole('button',{name:'保存 Notes',exact:true}).click();await ready(page);assert.equal((await state(page)).dayNotes[0].text,'简历已提交，滑雪邮件保留两家。');
  await page.screenshot({path:'test-results/workspace-plan.png'});
  await page.getByRole('button',{name:'展开周日历',exact:true}).click();await expect(page.getByTestId('calendar-grid')).toBeVisible();await expect(page.locator('.current-time')).toHaveCount(1);await page.getByRole('button',{name:'收起周日历',exact:true}).click();
  await page.getByRole('button',{name:'回看',exact:true}).click();await expect(page.locator('.activity-block')).toHaveCount(1);assert.equal((await state(page)).fixedEvents.length,2);
  await expect(page.locator('.activity-block')).not.toContainText('inferred');await expect(page.locator('.activity-block')).not.toContainText('大约');
  await page.locator('.activity-block').click();await page.getByLabel('开始',{exact:true}).fill(`${today}T14:00`);await page.getByLabel('结束',{exact:true}).fill(`${today}T16:00`);await page.getByRole('button',{name:'保存记录',exact:true}).click();await expect(page.getByRole('dialog')).toHaveCount(0);await ready(page);
  await expect(page.locator('.activity-block')).toContainText('14:00–16:00');await page.screenshot({path:'test-results/workspace-history.png'});
  const activityId=(await state(page)).activities[0].id;await page.locator('.activity-block').dispatchEvent('dragstart');
  const target=page.locator('.calendar-day').first();const box=await target.boundingBox();await target.dispatchEvent('drop',{clientY:box.y+12*48});await ready(page);assert.equal((await state(page)).activities[0].id,activityId);
  await page.getByRole('button',{name:'撤销',exact:true}).click();await ready(page);await expect(page.locator('.activity-block')).toContainText('14:00–16:00');
  await page.getByRole('button',{name:'安排',exact:true}).click();
  await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].setBounds({width:960,height:720}));await page.getByRole('button',{name:'打开对话',exact:true}).click();await page.screenshot({path:'test-results/workspace-small.png'});
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false,'No outer horizontal overflow');assert.equal(await page.evaluate(()=>window.scrollY),0);assert.equal(await page.locator('.app-shell').evaluate(shell=>shell.scrollTop),0);assert.ok(await page.locator('.chat-composer').evaluate(composer=>composer.getBoundingClientRect().bottom<=innerHeight),'Chat composer stays visible');
  await page.getByRole('button',{name:'收起对话',exact:true}).click();await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].setBounds({width:1440,height:920}));
  await page.getByRole('button',{name:'检查求职邮件',exact:true}).click();await expect(page.getByText('先在设置中连接 Gmail。',{exact:true})).toBeVisible();await page.getByRole('button',{name:'关闭对话框',exact:true}).click();
  const badLink=await page.evaluate(async()=>{try{await window.planner.openLink('file:///C:/Windows/notepad.exe');return '';}catch(error){return error.message;}});assert.match(badLink,/secure web links/);
  const beforeSync=await state(page);const failedSync=await page.evaluate(()=>window.planner.syncCalendar());assert.equal(failedSync.settings.calendarSync.state,'error');assert.deepEqual(failedSync.fixedEvents,beforeSync.fixedEvents);
  await page.getByRole('button',{name:'设置',exact:true}).click();await page.getByLabel('OpenAI API key',{exact:true}).fill('unit-only-do-not-call');await page.getByRole('button',{name:'保存设置',exact:true}).click();await expect(page.getByLabel('OpenAI API key',{exact:true})).toHaveValue('');await page.getByRole('button',{name:'关闭对话框',exact:true}).click();
  assert.equal((await readFile(resolve(dataDir,'credentials.secrets'))).includes(Buffer.from('unit-only-do-not-call')),false);
  await page.evaluate(async()=>{const state=await window.planner.snapshot();await window.planner.apply([{type:'create_task',task:{title:'Redaction check',notes:'unit-only-do-not-call'}}],state.revision);});
  let protectedState=await state(page);assert.equal(JSON.stringify(protectedState).includes('unit-only-do-not-call'),false);assert.equal(errors.length,0,errors.join('; '));
  await writeFile(requestPath,JSON.stringify({id:randomUUID(),expectedRevision:protectedState.revision,sourceMessage:'unit-only-do-not-call',actions:[{type:'create_task',task:{title:'Work redaction check',notes:'unit-only-do-not-call'}}]}));
  const redactedDelivery=JSON.parse((await exec(process.execPath,['scripts/planner.mjs','apply','--file',requestPath,'--bridge-dir',bridgeDir])).stdout);
  assert.equal(redactedDelivery.status,'applied');protectedState=await state(page);
  assert.equal(JSON.stringify(protectedState).includes('unit-only-do-not-call'),false);
  const bridgeSnapshot=(await exec(process.execPath,['scripts/planner.mjs','snapshot','--bridge-dir',bridgeDir])).stdout;
  assert.equal(bridgeSnapshot.includes('unit-only-do-not-call'),false);assert.equal(JSON.parse(bridgeSnapshot).settings,undefined);
  await app.close();app=undefined;page=await launch();const restarted=await state(page);
  for(const key of ['revision','tasks','fixedEvents','activities','dayNotes','messages','proposals','history'])assert.deepEqual(restarted[key],protectedState[key],`Restart changed ${key}`);
  await page.screenshot({path:'test-results/desktop-final.png'});
  console.log('Desktop verification passed: local Work CLI delivery/retry/undo/redaction, daily layout, direct chat/discussion, completion/reopen, local history, next-day events, Notes, week view, secure storage, failed sync preservation and restart.');console.log(`Isolated data: ${dataDir}`);
}catch(error){if(app){const page=await app.firstWindow();await page.screenshot({path:'test-results/desktop-failure.png'}).catch(()=>undefined);console.error('Visible errors:',await page.getByRole('alert').allTextContents());}throw error;}finally{if(app)await app.close();}
