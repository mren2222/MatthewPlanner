# Engineering backlog

| ID | Owner | Status | Dependencies | Files | Acceptance |
|---|---|---|---|---|---|
| B0 | Lead | Complete | None | scaffold/docs/core | Tooling, contracts, Git scaffold, Electron boot |
| D1 | Core/Data agent | Complete and integrated | B0 | src/db, src/services, core/validation, tests/data | SQLite CRUD, validated transactions, audit, undo, restart tests |
| A1 | AI agent | Complete and integrated | B0 | src/ai, tests/ai | Offline examples, live structured API boundary, clarification, no DB access |
| U1 | UI agent | Complete and integrated | B0 | src/ui | Day/duration CRUD, events, chat proposals, review, activity, settings |
| C1 | Calendar agent | Complete and cherry-picked | B0 | src/calendar, tests/calendar, docs/ICLOUD | CalDAV discovery/read/explicit writes, secure secrets, mock tests |
| I1 | Lead | Complete; unpacked and portable Windows builds | D1 A1 U1 C1 | src/electron/scripts/release | IPC/security/integration, packaged app, desktop flows |
| R1 | Fresh reviewer | Complete; reported findings addressed | I1 | docs/REVIEW | Security and correctness review, high findings fixed |

Git author identity is configured locally as supplied by user. First three agents started with exclusive directory ownership before a base commit could be made; calendar uses an isolated agent/calendar worktree now that the base exists. No remote repository created. Live providers require user-supplied credentials, which are not blockers for offline MVP.

Final validation: 68 unit/presentation/provider tests, typecheck, lint, build and packaged Windows Electron desktop flows pass. Development Vite/Electron shell and CSP nonce verified. The packaged app survives restart with tasks/events/activity/chat/proposals/history intact. OS DPAPI test uses a harmless key in isolated data. All test data is isolated in ignored test-results directories. User application data is not seeded or altered by tests.

Manual configuration remaining: enter optional OpenAI API key/model and Apple Account app-specific password in Settings. Live account access is unverified without those credentials. Read imported events and publish explicit fixed events after choosing a calendar; edit imported events in Calendar and refresh. No automatic notification daemon or background scheduling service is included.
