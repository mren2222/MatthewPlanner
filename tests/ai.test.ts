import { describe, expect, it, vi } from 'vitest';
import type { PlannerContext, Task } from '../src/core/types';
import { buildPlannerContext, createPlannerReply, OpenAIPlannerProvider, reviewToday, validatePlannerReply } from '../src/ai';

const task = (id: string, title: string): Task => ({ id, title, status: 'planned', priority: 'normal',
  plannedDate: '2026-10-07', estimatedDurationMinutes: 60,
  createdAt: '2026-10-07T08:00:00-07:00', updatedAt: '2026-10-07T08:00:00-07:00' });
const context = (): PlannerContext => ({ today: '2026-10-07', now: '2026-10-07T12:00:00-07:00',
  timezone: 'America/Los_Angeles', tasks: [task('portfolio', 'Portfolio'), task('dri', 'DRI follow-up'),
    task('amazon', 'Prepare Amazon Leo interview'), task('a', 'A'), task('b', 'B'), task('surface', 'surface modeling')],
  fixedEvents: [], activities: [], history: [], messages: [] });
const fakeResponse = (reply: unknown) => new Response(JSON.stringify({ status: 'completed', output: [
  { type: 'message', content: [{ type: 'output_text', text: JSON.stringify(reply) }] },
] }), { status: 200 });

describe('offline representative planning', () => {
  it.each(['portfolio今天不做了，周五吧', 'Move Portfolio to Friday'])('moves a task by date: %s', async message => {
    const reply = await createPlannerReply(message, context());
    expect(reply.message).toContain('Offline');
    expect(reply.actions).toEqual([{ type: 'move_task', taskId: 'portfolio', plannedDate: '2026-10-09' }]);
  });
  it.each(['明天Amazon Leo面试比较重要，准备一个小时', 'Amazon is important tomorrow, give it an hour'])('updates Amazon by day/duration: %s', async message => {
    const reply = await createPlannerReply(message, context());
    expect(reply.actions).toEqual([{ type: 'update_task', taskId: 'amazon', patch: {
      plannedDate: '2026-10-08', estimatedDurationMinutes: 60, priority: 'high',
    } }]);
  });
  it('creates Amazon preparation only when no matching task exists', async () => {
    const state = context(); state.tasks = [];
    const reply = await createPlannerReply('明天Amazon准备一个小时', state);
    expect(reply.actions).toEqual([{ type: 'create_task', task: { title: 'Prepare Amazon Leo interview',
      plannedDate: '2026-10-08', estimatedDurationMinutes: 60, priority: 'normal' } }]);
  });
  it.each(['DRI面试结束了，很顺利', 'DRI went well and is done'])('completes DRI without invented actuals: %s', async message => {
    expect((await createPlannerReply(message, context())).actions).toEqual([{ type: 'complete_task', taskId: 'dri' }]);
  });
  it.each(['A和B都完成了', 'A and B are done'])('completes multiple clearly named tasks: %s', async message => {
    expect((await createPlannerReply(message, context())).actions).toEqual([
      { type: 'complete_task', taskId: 'a' }, { type: 'complete_task', taskId: 'b' },
    ]);
  });
  it('records a stated duration without silently assuming completion', async () => {
    const reply = await createPlannerReply('今天surface modeling做了三个小时', context());
    expect(reply.actions).toEqual([{ type: 'record_activity', taskId: 'surface', activity: {
      durationMinutes: 180, confidence: 'approximate', source: 'manual',
    } }]);
  });
  it('preserves decimal hours and does not confuse an article with task A', async () => {
    expect((await createPlannerReply('Portfolio 1.5 hours', context())).actions).toEqual([
      { type: 'change_estimate', taskId: 'portfolio', estimatedDurationMinutes: 90 },
    ]);
    expect((await createPlannerReply('Amazon tomorrow a hour', context())).actions).toEqual([
      { type: 'update_task', taskId: 'amazon', patch: { plannedDate: '2026-10-08', estimatedDurationMinutes: 60 } },
    ]);
  });
  it.each(['portfolio今天没做', 'Portfolio was missed today'])('asks what to do with missed work: %s', async message => {
    const reply = await createPlannerReply(message, context()); expect(reply.actions).toEqual([]);
    expect(reply.clarification).toBeTruthy();
  });
  it('handles the combined Chinese example', async () => {
    const reply = await createPlannerReply('DRI面试很顺利，已经结束了。portfolio放周五吧，明天Amazon比较重要，准备一个小时。', context());
    expect(reply.actions.map(action => action.type)).toEqual(['complete_task', 'move_task', 'update_task']);
  });
  it('keeps an omitted subject with its requested tomorrow destination', async () => {
    expect((await createPlannerReply('portfolio今天不做了，明天吧', context())).actions).toEqual([
      { type: 'move_task', taskId: 'portfolio', plannedDate: '2026-10-08' },
    ]);
  });
  it('asks for ambiguous alias matches without changing either task', async () => {
    const state = context(); state.tasks.push(task('dri2', 'DRI interview preparation'));
    const reply = await createPlannerReply('DRI is done', state);
    expect(reply.actions).toEqual([]); expect(reply.clarification).toContain('Several');
  });
  it('reviews incomplete work without moving any task', () => {
    const before = context(); const copy = structuredClone(before);
    const reply = reviewToday(before); expect(reply.actions).toEqual([]);
    expect(reply.clarification).toContain('Portfolio'); expect(before).toEqual(copy);
  });
});

describe('live provider boundary', () => {
  it('uses strict Responses schema, store:false, configurable model and validated proposals', async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(fakeResponse({ message: 'Move Portfolio', clarification: null,
      actions: [{ type: 'move_task', taskId: 'portfolio', plannedDate: '2026-10-09' }] }));
    const reply = await createPlannerReply('Move Portfolio to Friday', context(), { apiKey: 'test-key', model: 'configured-model', fetch: fetchMock });
    expect(reply.actions).toHaveLength(1);
    const body = JSON.parse(fetchMock.mock.calls[0][1]?.body as string);
    expect(body.model).toBe('configured-model'); expect(body.store).toBe(false);
    expect(body.text.format).toMatchObject({ type: 'json_schema', name: 'planner_reply', strict: true });
    expect(body.input.includes('test-key')).toBe(false);
  });
  it('normalizes nullable optional action fields', async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(fakeResponse({ message: 'Done', clarification: null,
      actions: [{ type: 'complete_task', taskId: 'dri', activity: null }] }));
    const reply = await new OpenAIPlannerProvider({ apiKey: 'test-key', model: 'model', fetch: fetchMock }).reply('DRI done', context());
    expect(reply.actions).toEqual([{ type: 'complete_task', taskId: 'dri' }]);
  });
  it('accepts clarification with an empty action array', async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(fakeResponse({ message: 'Which date?', clarification: 'When?', actions: [] }));
    expect((await createPlannerReply('Portfolio missed', context(), { apiKey: 'test-key', model: 'model', fetch: fetchMock })).clarification).toBe('When?');
  });
  it.each([
    { status: 'incomplete', output: [] },
    { status: 'completed', output: [{ type: 'message', content: [{ type: 'refusal', refusal: 'private contents' }] }] },
    { status: 'completed', output: [{ type: 'message', content: [{ type: 'output_text', text: 'not JSON private contents' }] }] },
  ])('returns no action for unusable responses', async response => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify(response)));
    const reply = await createPlannerReply('DRI done', context(), { apiKey: 'test-key', model: 'model', fetch: fetchMock });
    expect(reply.actions).toEqual([]); expect(JSON.stringify(reply).includes('private contents')).toBe(false);
  });
  it('does not echo provider errors or response bodies', async () => {
    const fetchMock = vi.fn<typeof fetch>().mockRejectedValue(new Error('Authorization: private-key'));
    const reply = await createPlannerReply('DRI done', context(), { apiKey: 'private-key', model: 'model', fetch: fetchMock });
    expect(reply.actions).toEqual([]); expect(JSON.stringify(reply).includes('private-key')).toBe(false);
  });
  it('rejects unknown IDs and task scheduling fields', () => {
    expect(() => validatePlannerReply({ message: 'done', actions: [{ type: 'complete_task', taskId: 'unknown' }] }, context())).toThrow();
    expect(() => validatePlannerReply({ message: 'block', actions: [{ type: 'update_task', taskId: 'amazon', patch: { scheduledStart: '10:00' } }] }, context())).toThrow();
  });
  it('rejects inferred activity overlapping a fixed event', () => {
    const state = context(); state.fixedEvents.push({ id: 'event', title: 'Interview', startAt: '2026-10-07T10:00:00-07:00',
      endAt: '2026-10-07T10:30:00-07:00', timezone: state.timezone, source: 'local',
      createdAt: state.now, updatedAt: state.now });
    expect(() => validatePlannerReply({ message: 'history', actions: [{ type: 'record_activity', taskId: 'a', activity: {
      startAt: '2026-10-07T10:00:00-07:00', endAt: '2026-10-07T11:00:00-07:00',
      durationMinutes: 60, confidence: 'inferred', source: 'ai_inferred',
    } }] }, state)).toThrow();
  });
  it('rejects overlapping inferred activities within one proposal', () => {
    const activity = { startAt: '2026-10-07T09:00:00-07:00', endAt: '2026-10-07T10:00:00-07:00', durationMinutes: 60, confidence: 'inferred' as const, source: 'ai_inferred' as const };
    expect(() => validatePlannerReply({ message: 'history', actions: [
      { type: 'record_activity', taskId: 'a', activity }, { type: 'record_activity', taskId: 'b', activity },
    ] }, context())).toThrow('Conflicting');
    expect(() => validatePlannerReply({ message: 'history', actions: [
      { type: 'record_activity', taskId: 'a', activity: { ...activity, confidence: 'exact' } },
    ] }, context())).toThrow();
  });
  it('bounds and redacts projected context without mutating original', () => {
    const state = context(); state.tasks = Array.from({ length: 100 }, (_, index) => ({ ...task(`task${index}`, 'Title'), notes: 'password=private api_key=private sk-abcdefgh123456789' }));
    state.messages.push({ id: 'message', role: 'user', content: 'abcd-efgh-ijkl-mnop', createdAt: state.now });
    const projected = buildPlannerContext(state);
    expect(projected.tasks).toHaveLength(80); expect(projected.truncated).toBe(true);
    expect(JSON.stringify(projected).includes('private')).toBe(false); expect(JSON.stringify(projected).includes('abcd-efgh-ijkl-mnop')).toBe(false);
    expect(state.tasks[0].notes).toContain('private');
  });
});
