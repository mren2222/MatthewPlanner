import type { ProposedAction } from '../core/types';
import type { PlannerStore } from '../db/store';

/** The mutation boundary used by manual input and explicitly accepted AI proposals. */
export class ActionService {
  constructor(private store: PlannerStore) {}
  apply(actions: ProposedAction[], expectedRevision: number, origin: 'manual' | 'ai' = 'manual', sourceMessage?: string) {
    return this.store.apply(actions, expectedRevision, origin, sourceMessage);
  }
  undo() { return this.store.undo(); }
  applyProposal(id: string) { return this.store.applyProposal(id); }
}
