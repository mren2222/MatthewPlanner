# Matthew Planner engineering rules

- Local-first, single-user Windows Electron application. No hosted backend.
- Flexible Task objects have a planned day and duration, never scheduled start/end fields.
- FixedEvent is separate. Only explicit fixed events can cross CalendarProvider.
- AI has no database import or mutation capability. Return ProposedAction objects; preview and validate them before ActionService applies them.
- All user mutations use validated services, audit entries, and transactions.
- Never put credentials in prompts, logs, SQLite, test fixtures, or Git. Use main-process OS-backed secure storage.
- Shared contracts in src/core/types.ts belong to Lead. Request contract changes rather than editing them silently.
- Add meaningful tests for important behavior, especially action validation, undo, persistence, ambiguity, and calendar isolation.
- Prefer maintainable direct implementations. Do not introduce cloud infrastructure or automatic time blocking.
- Keep ownership boundaries and docs/TASKS.md current. Review integration before commits.
