# Shared contracts

Canonical definitions: src/core/types.ts. Do not independently redefine them.

Task includes status inbox/planned/completed/cancelled, ISO local date (YYYY-MM-DD), minutes, priority, category/project, deadline, notes and confidence-labelled actual history. No scheduled time fields.

FixedEvent contains ISO timestamps, timezone, location, source local/icloud and optional external identifiers. ActivityRecord stores actual minutes and optional timestamps with exact/approximate/inferred confidence.

ProposedAction is a discriminated union of create/update/complete/cancel/move/estimate/note/activity task operations and create/update/delete fixed event operations. Unknown fields and invalid dates/durations/IDs are rejected. Partial updates never overwrite identifiers, source or audit timestamps.

PlannerAPI is the only renderer bridge. snapshot returns persistent state, dayNotes and redacted settings including transient sync status. apply(actions, expectedRevision) handles manual batches. Clear chat commands create and apply validated proposals directly; discussion/clarification does not mutate. Legacy applyProposal checks stored revision. undo is deterministic. Calendar publishing is explicit and separate. Gmail connection/list/selected import and secure HTTPS link opening are narrow main-process methods.

0.2.0 Lead additions: reopen_task, set_day_note, update_activity; complete_task.completedDate; ActivityRecord.completionGenerated; FixedEvent.allDay; DayNote, SyncStatus, MailCandidate and Gmail settings. Completion and local-history editing share the transaction/audit/undo boundary with Todo. Processed email IDs are internal and never contain tokens.

Data agent export expectations: async createStore(filePath, wasmPath?) returns PlannerStore; store.snapshotData() returns state without settings, revision, messages and proposals included; store.apply(actions, revision, origin, sourceMessage?) and store.undo(); store.addMessage(), saveProposal(), setProposalStatus(), importEvents(); store.close(). Keep these synchronous after initialization. Action validation export validateActions(input): ProposedAction[]. Lead will coordinate exact signatures.

AI agent exports createPlannerReply(message, context, config?) and reviewToday(context); config contains optional apiKey/model, supplied only in main. Calendar agent exports CalendarProvider and ICloudCalendarProvider plus SecureCredentialStore wrapping an injected Electron safeStorage interface.
