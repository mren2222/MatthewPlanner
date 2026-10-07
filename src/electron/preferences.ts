import type { PrivateSettings } from './credentials';

export const DEFAULT_AI_MODEL = 'gpt-5.6-luna';
export const AI_MODEL_PREFERENCE_VERSION = 1;

/** Upgrade the previous default once; later explicit model choices remain respected. */
export function selectedAIModel(settings: PrivateSettings, environmentModel?: string): string {
  if (settings.aiModel === 'gpt-4o-mini' && settings.aiModelPreferenceVersion !== AI_MODEL_PREFERENCE_VERSION) return DEFAULT_AI_MODEL;
  return settings.aiModel || environmentModel || DEFAULT_AI_MODEL;
}
