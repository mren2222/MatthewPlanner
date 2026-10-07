import { _electron as electron, expect } from '@playwright/test';
import electronPath from 'electron';
import { mkdtemp, mkdir, readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import assert from 'node:assert/strict';

await mkdir('test-results', { recursive: true });
const dataDir = await mkdtemp(resolve('test-results/desktop-'));
const env = { ...process.env, PLANNER_E2E: '1', PLANNER_DATA_DIR: dataDir };
delete env.ELECTRON_RUN_AS_NODE; delete env.OPENAI_API_KEY; delete env.PLANNER_DEV_URL;
let app;
const packaged = process.argv.includes('--packaged');
async function launch() {
  app = await electron.launch({ executablePath: packaged ? resolve('release/win-unpacked/Matthew Planner.exe') : electronPath, args: packaged ? [] : [resolve('.')], env, timeout: 30000 });
  const page = await app.firstWindow();
  page.setDefaultTimeout(12000);
  await expect(page.getByTestId('new-task')).toBeVisible();
  return page;
}
const state = page => page.evaluate(() => window.planner.snapshot());
const ready = async page => { await expect(page.getByTestId('new-task')).toBeEnabled(); };
async function createTask(page, title, minutes = 60) {
  await page.getByTestId('new-task').click();
  await page.getByTestId('task-title').fill(title);
  await page.getByTestId('task-duration').fill(String(minutes));
  await page.getByRole('button', { name: 'Create task', exact: true }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await ready(page);
}
async function chat(page, text) {
  await page.getByTestId('chat-input').fill(text);
  await page.getByRole('button', { name: 'Send message', exact: true }).click();
  await ready(page);
}
try {
  let page = await launch();
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  assert.equal(await page.evaluate(() => typeof window.require), 'undefined');
  assert.equal((await state(page)).settings.aiConfigured, false);
  await createTask(page, 'Portfolio');
  await expect(page.getByTestId('daily-total')).toHaveText('1h');
  await page.getByRole('button', { name: 'Edit Portfolio', exact: true }).click();
  await page.getByTestId('task-duration').fill('90');
  await page.getByLabel('Notes', { exact: true }).fill('Fix portfolio landing page');
  await page.getByRole('button', { name: 'Save task', exact: true }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page.getByTestId('daily-total')).toHaveText('1h 30m');
  await createTask(page, 'DRI follow-up', 30);
  const beforeChat = await state(page);
  await chat(page, 'portfolio今天不做了，明天吧');
  await expect(page.getByRole('button', { name: 'Apply changes', exact: true })).toBeVisible();
  assert.deepEqual((await state(page)).tasks, beforeChat.tasks, 'Chat must not mutate tasks');
  await page.screenshot({ path: 'test-results/proposal-preview.png' });
  await page.getByRole('button', { name: 'Apply changes', exact: true }).click();
  await ready(page);
  let snap = await state(page);
  assert.notEqual(snap.tasks.find(t => t.title === 'Portfolio').plannedDate, beforeChat.tasks.find(t => t.title === 'Portfolio').plannedDate);
  assert.equal(snap.fixedEvents.length, 0, 'Flexible changes must not create calendar events');
  await page.getByRole('button', { name: 'Complete DRI follow-up', exact: true }).click();
  await page.getByTestId('actual-duration').fill('35');
  await page.getByRole('button', { name: 'Mark complete', exact: true }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  snap = await state(page);
  assert.equal(snap.tasks.find(t => t.title === 'DRI follow-up').actualDurationMinutes, 35);
  assert.equal(snap.activities[0].confidence, 'approximate');
  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  await ready(page);
  assert.equal((await state(page)).activities.length, 0);
  await chat(page, 'DRI面试结束了，很顺利');
  await page.getByRole('button', { name: 'Apply changes', exact: true }).click();
  await ready(page);
  snap = await state(page);
  assert.equal(snap.tasks.find(t => t.title === 'DRI follow-up').status, 'completed');
  assert.equal(snap.tasks.find(t => t.title === 'DRI follow-up').actualDurationMinutes, undefined);
  await createTask(page, 'Review task', 20);
  const beforeReview = await state(page);
  await page.getByTestId('review-today').click();
  await ready(page);
  assert.deepEqual((await state(page)).tasks, beforeReview.tasks, 'Review must ask without rescheduling');
  await page.getByRole('button', { name: 'Move Review task', exact: true }).click();
  await page.getByLabel('New planned day').fill(snap.tasks.find(t => t.title === 'Portfolio').plannedDate);
  await page.getByRole('button', { name: 'Move task', exact: true }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await createTask(page, 'Cancel task', 10);
  await page.getByRole('button', { name: 'Cancel Cancel task', exact: true }).click();
  await ready(page);
  assert.equal((await state(page)).tasks.find(t => t.title === 'Cancel task').status, 'cancelled');

  await page.getByRole('button', { name: 'Add fixed event', exact: true }).click();
  await page.getByLabel('Event title').fill('Optikos interview');
  await page.getByRole('button', { name: 'Save event locally', exact: true }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  snap = await state(page);
  assert.equal(snap.fixedEvents[0].title, 'Optikos interview');
  await expect(page.getByRole('button', { name: 'Publish Optikos interview to iCloud', exact: true })).toBeDisabled();
  await createTask(page, 'Surface modeling', 120);
  await page.getByRole('button', { name: 'Complete Surface modeling', exact: true }).click();
  await page.getByTestId('actual-duration').fill('180');
  const priorDay = new Date(`${beforeChat.tasks[0].plannedDate}T12:00:00`); priorDay.setDate(priorDay.getDate()-1);
  const historyDay = `${priorDay.getFullYear()}-${String(priorDay.getMonth()+1).padStart(2,'0')}-${String(priorDay.getDate()).padStart(2,'0')}`;
  await page.getByLabel('Add a historical interval').check();
  await page.getByLabel('Actual start', { exact: true }).fill(`${historyDay}T09:00`);
  await page.getByLabel('Actual end', { exact: true }).fill(`${historyDay}T12:00`);
  await page.getByLabel('Activity confidence').selectOption('inferred');
  await page.getByRole('button', { name: 'Mark complete', exact: true }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  assert.equal((await state(page)).activities.at(-1).confidence, 'inferred');
  await page.getByRole('button', { name: 'Activity', exact: true }).click();
  await expect(page.getByText('Inferred interval', { exact: true }).first()).toBeVisible();
  await page.screenshot({ path: 'test-results/activity-history.png' });
  await page.getByRole('button', { name: 'Today', exact: false }).first().click();
  await createTask(page, 'Earlier unfinished task', 30);
  await page.getByRole('button', { name: 'Edit Earlier unfinished task', exact: true }).click();
  await page.getByTestId('task-day').fill(historyDay);
  await page.getByRole('button', { name: 'Save task', exact: true }).click();
  await expect(page.getByTestId('earlier-work')).toContainText('Earlier unfinished task');
  await page.getByTestId('planning-day').fill(snap.tasks.find(t => t.title === 'Portfolio').plannedDate);
  await expect(page.getByRole('button', { name: 'Edit Portfolio', exact: true })).toBeVisible();
  await page.getByTestId('planning-day').fill(beforeChat.tasks[0].plannedDate);
  assert.equal(await page.evaluate(() => window.scrollY), 0, 'Chat history must not scroll the application shell');

  // Verify stale proposal rejection through the real, sender-validated IPC bridge.
  await chat(page, 'Move Portfolio to Friday');
  let pending = (await state(page)).proposals.find(p => p.status === 'pending');
  assert.ok(pending);
  await createTask(page, 'New revision', 15);
  const staleError = await page.evaluate(async id => { try { await window.planner.applyProposal(id); return ''; } catch (error) { return error.message; } }, pending.id);
  assert.match(staleError, /plan has changed/i);
  await page.evaluate(id => window.planner.cancelProposal(id), pending.id);
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await page.getByLabel('OpenAI API key', { exact: true }).fill('test-only-do-not-call');
  await page.getByRole('button', { name: 'Save settings', exact: true }).click();
  await expect(page.getByLabel('OpenAI API key', { exact: true })).toHaveValue('');
  await page.getByRole('button', { name: 'Close dialog', exact: true }).click();
  const persisted = await state(page);
  assert.equal(persisted.settings.aiConfigured, true);
  assert.equal((await readFile(resolve(dataDir, 'credentials.secrets'))).includes(Buffer.from('test-only-do-not-call')), false, 'Windows DPAPI file must not contain plaintext key');
  assert.equal(persisted.settings.openaiKey, undefined);
  assert.equal(persisted.settings.applePassword, undefined);
  await page.evaluate(async () => { const state = await window.planner.snapshot(); await window.planner.apply([{ type: 'create_task', task: { title: 'Redaction verification', notes: 'test-only-do-not-call' } }], state.revision); });
  const protectedState = await state(page);
  assert.equal(JSON.stringify(protectedState).includes('test-only-do-not-call'), false, 'Known secrets must not enter tasks or audits');
  assert.equal(errors.length, 0, `Renderer errors: ${errors.join('; ')}`);
  await app.close(); app = undefined;
  page = await launch();
  const restarted = await state(page);
  for (const key of ['revision', 'tasks', 'fixedEvents', 'activities', 'messages', 'proposals', 'history']) assert.deepEqual(restarted[key], protectedState[key], `Restart changed ${key}`);
  await page.screenshot({ path: 'test-results/desktop-final.png' });
  console.log('Desktop E2E passed: CRUD, totals, AI preview/apply, actuals, undo, review, move/cancel, fixed events, inferred history, stale proposal protection, sandbox and restart persistence.');
  console.log(`Isolated test data: ${dataDir}`);
} catch (error) {
  if (app) {
    const page = await app.firstWindow();
    await page.screenshot({ path: 'test-results/desktop-failure.png' }).catch(() => undefined);
    console.error('Visible application errors:', await page.getByRole('alert').allTextContents());
  }
  throw error;
} finally { if (app) await app.close(); }
