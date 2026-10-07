import { _electron as electron, expect } from '@playwright/test';
import electronPath from 'electron';
import { createServer } from 'vite';
import { mkdir, mkdtemp } from 'node:fs/promises';
import { resolve } from 'node:path';
import assert from 'node:assert/strict';
await mkdir('test-results', { recursive: true });
const data = await mkdtemp(resolve('test-results/dev-'));
const server = await createServer();
let app;
try {
  await server.listen();
  const env = { ...process.env, PLANNER_E2E: '1', PLANNER_DATA_DIR: data, PLANNER_DEV_URL: 'http://127.0.0.1:5173' };
  delete env.ELECTRON_RUN_AS_NODE; delete env.OPENAI_API_KEY;
  app = await electron.launch({ executablePath: electronPath, args: [resolve('.')], env });
  const page = await app.firstWindow();
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
  await expect(page.getByTestId('new-task')).toBeVisible();
  await page.getByTestId('new-task').click();
  await page.getByTestId('task-title').fill('Development shell verification');
  await page.getByRole('button', { name: '保存任务', exact: true }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  assert.equal((await page.evaluate(() => window.planner.snapshot())).tasks.length, 1);
  assert.deepEqual(errors, [], 'Development shell should have no renderer or CSP errors');
  console.log('Development Electron shell passed: Vite, CSP nonce, sandboxed preload and validated IPC.');
} finally { if (app) await app.close(); await server.close(); }
