# Matthew Planner engineering rules

- Local-first, single-user Windows Electron application. No hosted backend.
- Flexible Task objects have a planned day and duration, never scheduled start/end fields.
- FixedEvent is separate. Only explicit fixed events can cross CalendarProvider.
- AI has no database import or mutation capability. Return ProposedAction objects; validate them before ActionService applies them. Per the user's approved redesign, clear chat commands apply immediately with undo; discussion and ambiguous requests do not mutate. Email extraction is limited to selected messages and validated actions. Calendar publishing remains explicit.
- All user mutations use validated services, audit entries, and transactions.
- Never put credentials in prompts, logs, SQLite, test fixtures, or Git. Use main-process OS-backed secure storage.
- Shared contracts in src/core/types.ts belong to Lead. Request contract changes rather than editing them silently.
- Add meaningful tests for important behavior, especially action validation, undo, persistence, ambiguity, and calendar isolation.
- Prefer maintainable direct implementations. Do not introduce cloud infrastructure or automatic time blocking.
- Keep ownership boundaries and docs/TASKS.md current. Review integration before commits.
- For routine Codex/Work planning, use docs/WORK_INPUT.md and scripts/planner.mjs. Never write SQLite directly. Only clear user-authorized actions may enter the local inbox; verify receipts and retain request IDs for exact retries. Computer connection and an open app are required; this interface has no iCloud publishing operation.
