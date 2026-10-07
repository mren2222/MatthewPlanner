import type { PlannerReply } from '../core/types';

export function isDiscussion(message: string): boolean {
  return /先.{0,4}讨论|先.{0,4}聊|不要.{0,4}(修改|执行|添加)|不.{0,2}改.{0,2}(代码|计划)|讨论一下|先想想|\b(?:discuss|brainstorm|do not change|don't change|don't apply)\b/i.test(message);
}
export function directReply(reply: PlannerReply, discussion: boolean): PlannerReply {
  if (discussion) return { message: reply.actions.length ? '我们先讨论，计划没有修改。' : reply.message, actions: [] };
  // A clarification never authorizes the rest of an ambiguous batch.
  return reply.clarification ? { ...reply, message: reply.clarification, actions: [] } : reply;
}
