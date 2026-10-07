import type { PlannerContext, PlannerReply } from '../core/types';
import { OfflinePlannerProvider } from './offline';
import { OpenAIPlannerProvider, validatePlannerReply, type AIConfig } from './provider';
export { buildPlannerContext, redactText } from './context';
export { OfflinePlannerProvider, reviewToday } from './offline';
export { OpenAIPlannerProvider, validatePlannerReply } from './provider';
export type { PlannerProvider, AIConfig } from './provider';

export async function createPlannerReply(message: string, context: PlannerContext, config: AIConfig = {}): Promise<PlannerReply> {
  if (!message.trim() || message.length > 4000) return { message: 'Enter a planning request of up to 4,000 characters.', actions: [] };
  const provider = config.apiKey ? new OpenAIPlannerProvider(config) : new OfflinePlannerProvider();
  const reply = await provider.reply(message, context);
  try { return validatePlannerReply(reply, context); }
  catch { return { message: 'The proposal could not be validated. Please clarify the task and requested change.', actions: [] }; }
}
