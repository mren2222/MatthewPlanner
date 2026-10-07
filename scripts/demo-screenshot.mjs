// Public documentation uses fabricated demo data in an isolated app profile.
import { _electron as electron, expect } from '@playwright/test';
import electronPath from 'electron';
import { mkdir, mkdtemp } from 'node:fs/promises';
import { resolve } from 'node:path';

await mkdir('test-results', { recursive: true });
await mkdir('docs/images', { recursive: true });
const env = { ...process.env, PLANNER_E2E: '1', PLANNER_DATA_DIR: await mkdtemp(resolve('test-results/demo-')) };
delete env.ELECTRON_RUN_AS_NODE; delete env.OPENAI_API_KEY; delete env.PLANNER_DEV_URL;
const app = await electron.launch({ executablePath: electronPath, args: [resolve('.')], env });
try {
  const page = await app.firstWindow();
  await expect(page.getByTestId('new-task')).toBeVisible();
  await page.setViewportSize({ width: 1440, height: 1060 });
  await page.evaluate(async () => {
    const date = new Date();
    const day = offset => {
      const value = new Date(date); value.setDate(value.getDate() + offset);
      return `${value.getFullYear()}-${String(value.getMonth()+1).padStart(2,'0')}-${String(value.getDate()).padStart(2,'0')}`;
    };
    const today = day(0), tomorrow = day(1);
    const event = (title, day, time, end) => ({ type: 'create_fixed_event', event: { title, startAt: new Date(`${day}T${time}:00`).toISOString(), endAt: new Date(`${day}T${end}:00`).toISOString(), timezone: Intl.DateTimeFormat().resolvedOptions().timeZone } });
    const snapshot = await window.planner.snapshot();
    await window.planner.apply([
      { type: 'create_task', task: { title: '准备明天的面试：项目介绍与提问', plannedDate: today, estimatedDurationMinutes: 60 } },
      { type: 'create_task', task: { title: '更新作品集', plannedDate: today, estimatedDurationMinutes: 60 } },
      { type: 'create_task', task: { title: '整理行业活动联系人', plannedDate: today, estimatedDurationMinutes: 30 } },
      { type: 'create_completed_task', task: { title: '提交岗位申请', estimatedDurationMinutes: 45 }, completedDate: today },
      { type: 'create_task', task: { title: '跟进上周的申请', plannedDate: day(-1), estimatedDurationMinutes: 30 } },
      { type: 'create_task', task: { title: '整理项目照片' } },
      event('产品工程师面试', today, '09:00', '10:00'),
      event('技术电话面试', tomorrow, '10:00', '11:00'),
      event('招聘团队电话', tomorrow, '14:00', '14:30'),
      { type: 'set_day_note', date: today, text: '上午面试顺利，已经提交新的岗位申请。\n今天把明天两场电话的项目介绍和问题准备好。' },
    ], snapshot.revision);
  });
  await page.reload();
  await expect(page.getByTestId('day-todo')).toContainText('准备明天的面试');
  await expect(page.getByLabel('每日 Notes')).toHaveValue(/上午面试顺利/);
  await page.locator('.main-content').evaluate(element => { element.scrollTop = 0; });
  await page.screenshot({ path: 'docs/images/planner.png', scale: 'css' });
  console.log('Public demo screenshot generated using isolated, fabricated data.');
} finally { await app.close(); }
