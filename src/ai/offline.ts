import type { PlannerContext, PlannerReply, ProposedAction, Task } from '../core/types';
import { addDays } from '../core/dates';
import { redactText } from './context';
import type { PlannerProvider } from './provider';

const label = 'Offline helper (limited deterministic commands). ';
const isChinese = (text: string) => /[\u3400-\u9fff]/u.test(text);
const active = (task: Task) => task.status === 'planned' || task.status === 'inbox';
const word = (text: string, token: string) => {
  // Single-letter task names require exact case, preventing the article 'a'
  // from being treated as task A. All matches use Latin token boundaries.
  const escaped = token.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`(?:^|[^a-z0-9])${escaped}(?=$|[^a-z0-9])`, token.length === 1 ? '' : 'i').test(text);
};

function candidates(text: string, context: PlannerContext): Task[] {
  const exact = context.tasks.filter(task => word(text, task.title));
  if (exact.length) return exact;
  const aliases = ['portfolio', 'amazon', 'dri', 'surface modeling', 'blue origin'];
  const alias = aliases.find(value => word(text, value));
  return alias ? context.tasks.filter(task => word(task.title, alias)) : [];
}

function duration(text: string): number | undefined {
  const digits: Record<string, number> = { 一: 1, 二: 2, 两: 2, 三: 3, 四: 4, 五: 5, 六: 6,
    七: 7, 八: 8, 九: 9, 十: 10, one: 1, an: 1, a: 1, two: 2, three: 3, half: 0.5 };
  const match = text.match(/(\d+(?:\.\d+)?|一|二|两|三|四|五|六|七|八|九|十|one|two|three|half|an|a)\s*(?:个)?\s*(小时|hours?\b|hrs?\b|h\b|分钟|minutes?\b|mins?\b|m\b)/i);
  if (!match) return undefined;
  const number = digits[match[1].toLowerCase()] ?? Number(match[1]);
  const minutes = number * (/小时|^h/i.test(match[2]) ? 60 : 1);
  return Number.isInteger(minutes) && minutes >= 1 && minutes <= 1440 ? minutes : undefined;
}

function date(text: string, today: string): string | undefined {
  const iso = text.match(/\b\d{4}-\d{2}-\d{2}\b/);
  if (iso) return iso[0]; // Canonical validator rejects nonexistent dates.
  if (/明天|tomorrow/i.test(text)) return addDays(today, 1);
  if (/后天/.test(text)) return addDays(today, 2);
  const days = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  const chinese = ['日', '一', '二', '三', '四', '五', '六'];
  const day = days.findIndex((name, index) => new RegExp(`\\b${name}\\b|(?:周|星期)${chinese[index]}`, 'i').test(text));
  if (day >= 0) {
    const current = new Date(`${today}T12:00:00`).getDay();
    let delta = (day - current + 7) % 7;
    if (/next|下周/i.test(text) && delta === 0) delta = 7;
    return addDays(today, delta);
  }
  if (/今天|today/i.test(text)) return today;
  return undefined;
}

export function interpretOffline(message: string, context: PlannerContext): PlannerReply {
  const actions: ProposedAction[] = [];
  const questions: string[] = [];
  const cn = isChinese(message);
  const clauses = message.split(/[。；;\n!?]+|(?<!\d)\.|\.(?!\d)|[,，](?=\s*(?:portfolio|amazon|dri|surface|blue origin|move|prepare|(?:明天|今天)(?:amazon|portfolio|dri|surface|blue origin)))/i)
    .map(value => value.trim()).filter(Boolean);
  for (const clause of clauses) {
    const matches = candidates(clause, context);
    const destination = date(clause, context.today);
    const minutes = duration(clause);
    const missed = /没做|没完成|不做|未完成|missed|didn['’]?t|not (?:done|finished)|unfinished|did not/i.test(clause);
    const complete = !missed && /做完|完成|结束|done\b|finished\b|complete[ds]?\b/i.test(clause);
    const cancel = /取消|cancel\b/i.test(clause);
    const move = /放|移|挪|推迟|move|reschedule|postpone/i.test(clause) || (missed && Boolean(destination) && destination !== context.today);
    const actual = /做了|花了|用了|spent|worked|took|actual/i.test(clause);
    // Distinguish named multiple completion from a single ambiguous project alias.
    const explicitMultiple = matches.length > 1 && matches.every(task => word(clause, task.title))
      && /和|与|、|\band\b|&/i.test(clause) && complete;
    if (matches.length > 1 && !explicitMultiple) {
      questions.push(cn ? `「${redactText(clause, 200)}」对应多个任务，请选择具体任务。`
        : `Several tasks match “${redactText(clause, 200)}”. Which task do you mean?`);
      continue;
    }
    if (!matches.length) {
      if (word(clause, 'amazon') && destination && minutes && !complete && !actual && !cancel && !missed) {
        actions.push({ type: 'create_task', task: { title: 'Prepare Amazon Leo interview', plannedDate: destination,
          estimatedDurationMinutes: minutes, priority: /重要|important/i.test(clause) ? 'high' : 'normal' } });
      } else questions.push(cn ? '请指出具体任务和要做的修改；完整自然语言规划需要在设置中配置 AI。'
        : 'Please name the task and change. Enable AI in Settings for full natural-language planning.');
      continue;
    }
    for (const task of matches) {
      if (!active(task)) { questions.push(cn ? `「${redactText(task.title, 200)}」已结束，请确认要如何修改。`
        : `“${redactText(task.title, 200)}” is already ${task.status}. Please clarify the change.`); continue; }
      if (cancel) { actions.push({ type: 'cancel_task', taskId: task.id }); continue; }
      if (missed && (!destination || destination === context.today)) {
        questions.push(cn ? `${redactText(task.title, 200)} 今天未完成。想放到明天、其他日期，还是取消？`
          : `${redactText(task.title, 200)} is unfinished. Move it to tomorrow, choose another date, or cancel it?`);
        continue;
      }
      if (complete) {
        if (explicitMultiple && minutes) {
          questions.push(cn ? '总实际时长如何分配给这些任务？' : 'How should the actual duration be divided between these tasks?');
          continue;
        }
        actions.push({ type: 'complete_task', taskId: task.id,
          ...(actual && minutes ? { activity: { durationMinutes: minutes, confidence: 'approximate' as const, source: 'manual' as const } } : {}) });
      } else if (actual && minutes) actions.push({ type: 'record_activity', taskId: task.id,
        activity: { durationMinutes: minutes, confidence: 'approximate', source: 'manual' } });
      else if (word(clause, 'amazon') && destination && minutes) actions.push({ type: 'update_task', taskId: task.id,
        patch: { plannedDate: destination, estimatedDurationMinutes: minutes,
          ...(/重要|important/i.test(clause) ? { priority: 'high' as const } : {}) } });
      else if (move && destination) actions.push({ type: 'move_task', taskId: task.id, plannedDate: destination });
      else if (minutes && !actual) actions.push({ type: 'change_estimate', taskId: task.id, estimatedDurationMinutes: minutes });
      else questions.push(cn ? `请说明「${redactText(task.title, 200)}」要完成、改日期、修改时长还是取消。`
        : `Should “${redactText(task.title, 200)}” be completed, moved, changed, or cancelled?`);
    }
  }
  // Duplicate clauses must not apply the same mutation twice.
  const unique = actions.filter((action, index) => actions.findIndex(candidate => JSON.stringify(candidate) === JSON.stringify(action)) === index);
  const clarification = [...new Set(questions)].join(' ');
  return { message: label + (unique.length ? (cn ? `已准备 ${unique.length} 项修改，请预览后应用。` : `${unique.length} change(s) ready to preview and apply.`)
    : (clarification ? (cn ? '请补充任务信息。' : 'No changes proposed; please clarify.') : (cn ? '请输入任务修改。' : 'Enter a task change.'))), actions: unique,
    ...(clarification ? { clarification } : {}) };
}

export class OfflinePlannerProvider implements PlannerProvider {
  async reply(message: string, context: PlannerContext): Promise<PlannerReply> { return interpretOffline(message, context); }
}

export function reviewToday(context: PlannerContext): PlannerReply {
  const tasks = context.tasks.filter(task => active(task) && task.plannedDate === context.today);
  if (!tasks.length) return { message: 'Today has no unfinished planned tasks. Your review is up to date.', actions: [] };
  const names = tasks.slice(0, 20).map(task => `${redactText(task.title, 200)}${task.estimatedDurationMinutes ? ` (${task.estimatedDurationMinutes}m)` : ''}`).join(', ');
  const clarification = `Today still has ${names}${tasks.length > 20 ? ` and ${tasks.length - 20} more` : ''}. Were they completed, should they move to a date you choose, or be cancelled?`;
  return { message: clarification, clarification, actions: [] };
}
