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
  it('retains interview facts through the user-reported clarification sequence', async () => {
    const state = context();
    const conversation = [
      ['user', '周五是magnix和dynamic research inc'], ['assistant', '请提供时间。'],
      ['user', '一个11一个14 西雅图时间'], ['assistant', '请说明对应关系。'],
      ['user', '按顺序对应 需要创建'], ['assistant', '每场持续多久？'],
      ['user', '半个小时'], ['assistant', '请提供日期。'], ['user', '这周五'],
    ] as const;
    state.messages = conversation.map(([role, content], i) => ({ id: String(i), role, content, createdAt: state.now }));
    const fetchMock = vi.fn<typeof fetch>().mockImplementation(async (_url, init) => {
      const body = JSON.parse(init?.body as string), input = JSON.parse(body.input);
      expect(input.context.messages.map((entry: {content: string}) => entry.content)).toEqual(conversation.map(([,content]) => content));
      expect(body.instructions).toContain('Do not ask again for facts already supplied');
      return fakeResponse({ message: '已添加两场周五面试。', actions: [
        { type: 'create_fixed_event', event: { title: 'Magnix 面试', startAt: '2026-10-09T11:00:00-07:00', endAt: '2026-10-09T11:30:00-07:00', timezone: state.timezone } },
        { type: 'create_fixed_event', event: { title: 'Dynamic Research Inc 面试', startAt: '2026-10-09T14:00:00-07:00', endAt: '2026-10-09T14:30:00-07:00', timezone: state.timezone } },
      ] });
    });
    const reply = await createPlannerReply('这周五', state, { apiKey: 'test-key', model: 'gpt-5.6-luna', fetch: fetchMock });
    expect(reply.actions).toHaveLength(2); expect(reply.clarification).toBeUndefined();
  });
  it('keeps Notes at the end of a pasted weekly plan and bounds long histories', () => {
    const state = context(), plan = '## 10/07 周三\n' + '准备项目介绍\n'.repeat(400) + '\nNotes\nDRI面试很顺利，明天还有Amazon Leo';
    state.messages = Array.from({ length: 70 }, (_,i) => ({ id:String(i), role:'user', content:'旧消息'.repeat(500), createdAt:state.now }));
    state.messages.push({ id:'plan',role:'user',content:plan,createdAt:state.now }, { id:'update',role:'user',content:'全部更新',createdAt:state.now });
    const projected = buildPlannerContext(state);
    expect(projected.messages.at(-2)?.content).toContain('明天还有Amazon Leo');
    expect(projected.messages.at(-1)?.content).toBe('全部更新');
    expect(projected.messages.length).toBeLessThanOrEqual(40);
    expect(projected.messages.reduce((sum,entry)=>sum+entry.content.length,0)).toBeLessThanOrEqual(48000);
    expect(projected.conversationTruncated).toBe(true);
  });
  it('supports completion reported by title without requiring a pre-existing internal ID', () => {
    const reply = validatePlannerReply({ message:'已记录 DRI 面试完成', actions:[{ type:'create_completed_task',task:{title:'DRI 面试'},completedDate:'2026-10-07' }] },context());
    expect(reply.actions[0].type).toBe('create_completed_task');
    expect(()=>validatePlannerReply({ message:'invalid',actions:[{ type:'create_completed_task',task:{title:'DRI 面试',scheduledStart:'08:00'},completedDate:'2026-10-07' }] },context())).toThrow();
  });
  it('uses low reasoning for Luna and accepts text split across output blocks', async () => {
    const wire = JSON.stringify({ message: 'Move Portfolio', clarification: null, actions: [{ type: 'move_task', taskId: 'portfolio', plannedDate: '2026-10-09' }] });
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify({ status: 'completed', output: [
      { type: 'reasoning' }, { type: 'message', content: [{ type: 'output_text', text: wire.slice(0, 20) }, { type: 'output_text', text: wire.slice(20) }] },
    ] })));
    const reply = await createPlannerReply('Move Portfolio', context(), { apiKey: 'test-key', model: 'gpt-5.6-luna', fetch: fetchMock });
    expect(reply.actions).toEqual([{ type: 'move_task', taskId: 'portfolio', plannedDate: '2026-10-09' }]);
    const body = JSON.parse(fetchMock.mock.calls[0][1]?.body as string);
    expect(body.reasoning).toEqual({ effort: 'low' });
    expect(body.max_output_tokens).toBe(8000);
  });
  it.each([[401, 'API key was rejected'], [403, 'cannot access'], [404, 'cannot access'], [429, 'credits and rate limits'], [400, 'request configuration'], [503, 'temporarily unavailable']] as const)('explains HTTP %i without exposing the error body', async (status, message) => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(new Response('private response contents', { status }));
    const reply = await createPlannerReply('DRI done', context(), { apiKey: 'test-key', model: 'gpt-5.6-luna', fetch: fetchMock });
    expect(reply.message).toContain(message);
    expect(reply.actions).toEqual([]);
    expect(JSON.stringify(reply).includes('private response contents')).toBe(false);
  });
  it('distinguishes invalid proposals from connection failures without echoing unsafe content', async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(fakeResponse({ message: 'private contents', actions: [{ type: 'complete_task', taskId: 'unknown' }] }));
    const reply = await createPlannerReply('DRI done', context(), { apiKey: 'test-key', model: 'gpt-5.6-luna', fetch: fetchMock });
    expect(reply.message).toContain('could not be safely validated');
    expect(reply.actions).toEqual([]);
    expect(JSON.stringify(reply).includes('private contents')).toBe(false);
  });
  it('distinguishes an output limit and unreadable response from network errors', async () => {
    for (const [wire, expected] of [[JSON.stringify({ status: 'incomplete', incomplete_details: { reason: 'max_output_tokens' } }), 'output limit'], ['not JSON', 'unreadable response'], [JSON.stringify({ status: 'completed', output: {} }), 'unreadable response']] as const) {
      const reply = await createPlannerReply('DRI done', context(), { apiKey: 'test-key', model: 'gpt-5.6-luna', fetch: async () => new Response(wire) });
      expect(reply.message).toContain(expected);
      expect(reply.actions).toEqual([]);
    }
  });
  it('reports timeouts separately and aborts response consumption', async () => {
    vi.useFakeTimers();
    try {
      const fetchMock: typeof fetch = async (_input, init) => new Promise((_resolve, reject) => init?.signal?.addEventListener('abort', () => reject(new Error('private network detail')), { once: true }));
      const pending = createPlannerReply('DRI done', context(), { apiKey: 'test-key', model: 'gpt-5.6-luna', fetch: fetchMock });
      await vi.advanceTimersByTimeAsync(60000);
      const reply = await pending;
      expect(reply.message).toContain('timed out after 60 seconds');
      expect(reply.actions).toEqual([]);
      expect(reply.message.includes('private network detail')).toBe(false);
    } finally { vi.useRealTimers(); }
  });
  it('uses strict Responses schema, store:false, configurable model and validated proposals', async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(fakeResponse({ message: 'Move Portfolio', clarification: null,
      actions: [{ type: 'move_task', taskId: 'portfolio', plannedDate: '2026-10-09' }] }));
    const reply = await createPlannerReply('Move Portfolio to Friday', context(), { apiKey: 'test-key', model: 'configured-model', fetch: fetchMock });
    expect(reply.actions).toHaveLength(1);
    const body = JSON.parse(fetchMock.mock.calls[0][1]?.body as string);
    expect(body.model).toBe('configured-model'); expect(body.store).toBe(false);
    expect(Object.hasOwn(body, 'reasoning')).toBe(false);
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
