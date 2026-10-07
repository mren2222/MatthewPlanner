import { app, BrowserWindow, ipcMain, Menu, safeStorage, dialog } from 'electron';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { createStore, type PlannerStore } from '../db/store';
import { ActionService } from '../services/actions';
import { validateActions } from '../core/validation';
import type { PlannerSnapshot, PlannerContext, SettingsInput, ProposedAction, Proposal } from '../core/types';
import { localDate } from '../core/dates';
import { createPlannerReply, reviewToday } from '../ai';
import { redactText } from '../ai/context';
import { CredentialVault, type PrivateSettings } from './credentials';

app.setName('Matthew Planner');
const testMode = process.env.PLANNER_E2E === '1';
if (testMode && process.env.PLANNER_DATA_DIR) app.setPath('userData', resolve(process.env.PLANNER_DATA_DIR));
const ownsInstance = app.requestSingleInstanceLock();
if (!ownsInstance) app.quit();
let window: BrowserWindow | null = null;
let store: PlannerStore;
let actions: ActionService;
let vault: CredentialVault;
let config: PrivateSettings = {};
let queue: Promise<unknown> = Promise.resolve();
const devURL = !app.isPackaged ? process.env.PLANNER_DEV_URL : undefined;
const uiPath = join(__dirname, '../ui/index.html');
const expectedURL = devURL ? new URL(devURL).href : pathToFileURL(uiPath).href;
function serialize<T>(fn: () => Promise<T> | T): Promise<T> {
  const next = queue.then(fn); queue = next.catch(() => undefined); return next;
}
function snapshot(): PlannerSnapshot {
  return { ...store.snapshotData(), settings: {
    aiConfigured: !!(config.openaiKey || process.env.OPENAI_API_KEY),
    aiModel: config.aiModel || process.env.PLANNER_AI_MODEL || 'gpt-4o-mini',
    calendarConfigured: !!(config.appleAccount && config.applePassword),
    calendarId: config.calendarId, appleAccount: config.appleAccount,
    secureStorageAvailable: vault.available()
  } };
}
function context(): PlannerContext {
  const data = store.snapshotData();
  const value: PlannerContext = { today: localDate(), now: new Date().toISOString(), timezone: Intl.DateTimeFormat().resolvedOptions().timeZone, tasks: data.tasks, fixedEvents: data.fixedEvents, activities: data.activities, history: data.history, messages: data.messages };
  return JSON.parse(JSON.stringify(value, (_key, entry) => typeof entry === 'string' ? stripKnownSecrets(entry) : entry)) as PlannerContext;
}
function stripKnownSecrets(value: string): string {
  let cleaned = value;
  for (const secret of [config.openaiKey, config.applePassword, process.env.OPENAI_API_KEY]) if (secret) cleaned = cleaned.split(secret).join('[redacted credential]');
  return cleaned;
}
function redactCredentials(value: string): string {
  return redactText(stripKnownSecrets(value), 10000);
}
function localActions(input: unknown): ProposedAction[] {
  const actions = validateActions(sanitizePlannerInput(input));
  const events = store.snapshotData().fixedEvents;
  for (const action of actions) {
    if ((action.type === 'update_fixed_event' || action.type === 'delete_fixed_event') && events.find(e => e.id === action.eventId)?.source === 'icloud') {
      throw new Error('Imported iCloud events are read-only here. Edit them in Calendar, then refresh.');
    }
  }
  return actions;
}
function sanitizePlannerInput(value: unknown, key = ''): unknown {
  if (typeof value === 'string' && ['title', 'description', 'notes', 'note', 'location', 'projectId'].includes(key)) return redactCredentials(value);
  if (Array.isArray(value)) return value.map(entry => sanitizePlannerInput(entry));
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([name, entry]) => [name, sanitizePlannerInput(entry, name)]));
  return value;
}
function saveReply(reply: { message: string; actions: ProposedAction[]; clarification?: string }, sourceMessage: string, baseRevision: number): void {
  const actions = reply.actions.length ? localActions(reply.actions) : [];
  const id = actions.length ? randomUUID() : undefined;
  if (id) {
    const proposal: Proposal = { ...reply, actions, id, baseRevision, sourceMessage, status: 'pending', createdAt: new Date().toISOString() };
    store.saveProposal(proposal);
  }
  store.addMessage({ id: randomUUID(), role: 'assistant', content: reply.clarification && reply.clarification !== reply.message ? `${reply.message}\n${reply.clarification}` : reply.message, createdAt: new Date().toISOString(), proposalId: id });
}
function handle(channel: string, fn: (...args: any[]) => unknown): void {
  ipcMain.handle(`planner:${channel}`, async (event, ...args: unknown[]) => {
    if (!window || event.sender !== window.webContents || event.senderFrame !== window.webContents.mainFrame || event.senderFrame.url !== expectedURL) throw new Error('Untrusted IPC sender.');
    try { return await serialize(() => fn(...args)); }
    catch (error) { throw new Error(redactCredentials(error instanceof Error ? error.message : 'The operation failed.')); }
  });
}
async function createWindow(): Promise<void> {
  window = new BrowserWindow({ width: 1440, height: 920, minWidth: 960, minHeight: 680, backgroundColor: '#f7f8fa', title: 'Matthew Planner', show: true,
    webPreferences: { preload: join(__dirname, 'preload.cjs'), nodeIntegration: false, contextIsolation: true, sandbox: true, webSecurity: true } });
  Menu.setApplicationMenu(null);
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  window.webContents.on('will-navigate', (event, url) => { if (url !== expectedURL) event.preventDefault(); });
  window.webContents.session.setPermissionRequestHandler((_webContents, _permission, callback) => callback(false));
  if (devURL) await window.loadURL(devURL); else await window.loadFile(uiPath);
  window.on('closed', () => { window = null; });
}
async function start(): Promise<void> {
  await app.whenReady();
  vault = new CredentialVault(join(app.getPath('userData'), 'credentials.secrets'), safeStorage);
  let credentialWarning = '';
  try { config = vault.read(); } catch (error) { credentialWarning = error instanceof Error ? error.message : 'Saved credentials are unavailable. Reconfigure them in Settings.'; }
  store = await createStore(join(app.getPath('userData'), 'planner.sqlite'), join(__dirname, 'sql-wasm.wasm'));
  actions = new ActionService(store);
  if (credentialWarning) store.addMessage({ id: randomUUID(), role: 'assistant', content: `${credentialWarning} Local planning remains available.`, createdAt: new Date().toISOString() });
  handle('snapshot', snapshot);
  handle('apply', (input: unknown, revision: unknown) => { actions.apply(localActions(input), z.number().int().nonnegative().parse(revision), 'manual'); return snapshot(); });
  handle('undo', () => { actions.undo(); return snapshot(); });
  handle('chat', async (input: unknown) => {
    const message = redactCredentials(z.string().trim().min(1).max(10000).parse(input));
    const baseRevision = store.snapshotData().revision;
    store.addMessage({ id: randomUUID(), role: 'user', content: message, createdAt: new Date().toISOString() });
    const reply = await createPlannerReply(message, context(), { apiKey: config.openaiKey || process.env.OPENAI_API_KEY, model: snapshot().settings.aiModel });
    saveReply(reply, message, baseRevision); return snapshot();
  });
  handle('applyProposal', (input: unknown) => {
    const id = z.string().uuid().parse(input);
    const proposal = store.snapshotData().proposals.find(p => p.id === id);
    if (!proposal || proposal.status !== 'pending') throw new Error('This proposal is no longer pending.');
    localActions(proposal.actions);
    actions.applyProposal(id); return snapshot();
  });
  handle('cancelProposal', (input: unknown) => {
    const id = z.string().uuid().parse(input);
    const proposal = store.snapshotData().proposals.find(p => p.id === id);
    if (!proposal || proposal.status !== 'pending') throw new Error('This proposal is no longer pending.');
    store.setProposalStatus(id, 'cancelled'); return snapshot();
  });
  handle('reviewToday', () => { saveReply(reviewToday(context()), 'Review Today', store.snapshotData().revision); return snapshot(); });
  handle('saveSettings', (input: unknown) => {
    const settings: SettingsInput = z.object({ openaiKey: z.string().max(1000).optional(), aiModel: z.string().trim().min(1).max(100).optional(), appleAccount: z.string().trim().max(320).optional(), applePassword: z.string().max(1000).optional(), calendarId: z.string().max(2000).optional(), clearAI: z.boolean().optional(), clearCalendar: z.boolean().optional() }).strict().parse(input);
    const next = { ...config };
    if (settings.clearAI) delete next.openaiKey;
    if (settings.clearCalendar) { delete next.appleAccount; delete next.applePassword; delete next.calendarId; }
    for (const name of ['openaiKey', 'aiModel', 'appleAccount', 'applePassword', 'calendarId'] as const) if (settings[name]?.trim()) next[name] = settings[name]!.trim();
    if (next.appleAccount !== config.appleAccount) delete next.calendarId;
    vault.write(next); config = next; return snapshot();
  });
  handle('listCalendars', () => { throw new Error('Calendar integration is being initialized.'); });
  handle('syncCalendar', () => { throw new Error('Calendar integration is being initialized.'); });
  handle('publishEvent', () => { throw new Error('Calendar integration is being initialized.'); });
  if (!testMode && new Date().getHours() >= 18 && store.snapshotData().tasks.some(t => t.plannedDate === localDate() && t.status === 'planned')) {
    const already = store.snapshotData().messages.some(m => m.role === 'assistant' && m.content.startsWith('Daily check-in') && localDate(new Date(m.createdAt)) === localDate());
    if (!already) { const reply = reviewToday(context()); saveReply({ ...reply, message: `Daily check-in\n${reply.message}` }, 'Late-day check-in', store.snapshotData().revision); }
  }
  await createWindow();
}
app.on('second-instance', () => { window?.show(); window?.focus(); });
app.on('window-all-closed', () => app.quit());
app.on('before-quit', () => { store?.close(); });
if (ownsInstance) start().catch(error => { dialog.showErrorBox('Matthew Planner could not start', error instanceof Error ? error.message : 'Startup failed.'); app.quit(); });
