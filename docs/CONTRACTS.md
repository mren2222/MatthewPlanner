# Shared contracts

Canonical definitions: src/core/types.ts. Do not independently redefine them.

Task includes status inbox/planned/completed/cancelled, ISO local date (YYYY-MM-DD), minutes, priority, category/project, deadline, notes and confidence-labelled actual history. No scheduled time fields.

FixedEvent contains ISO timestamps, timezone, location, source local/icloud and optional external identifiers. ActivityRecord stores actual minutes and optional timestamps with exact/approximate/inferred confidence.

ProposedAction is a discriminated union of create/update/complete/cancel/move/estimate/note/activity task operations and create/update/delete fixed event operations. Unknown fields and invalid dates/durations/IDs are rejected. Partial updates never overwrite identifiers, source or audit timestamps.

PlannerAPI is the only renderer bridge. snapshot returns current persistent state with redacted settings. apply(actions, expectedRevision) handles manual batches. chat creates pending proposals; applyProposal checks stored revision. undo is deterministic. Calendar publishing is explicit and separate.

Data agent export expectations: async createStore(filePath, wasmPath?) returns PlannerStore; store.snapshotData() returns state without settings, revision, messages and proposals included; store.apply(actions, revision, origin, sourceMessage?) and store.undo(); store.addMessage(), saveProposal(), setProposalStatus(), importEvents(); store.close(). Keep these synchronous after initialization. Action validation export validateActions(input): ProposedAction[]. Lead will coordinate exact signatures.

AI agent exports createPlannerReply(message, context, config?) and reviewToday(context); config contains optional apiKey/model, supplied only in main. Calendar agent exports CalendarProvider and ICloudCalendarProvider plus SecureCredentialStore wrapping an injected Electron safeStorage interface.
