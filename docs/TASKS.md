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
| C2 | Lead | Complete; user confirmed live access | C1 | src/calendar, tests/calendar, docs/ICLOUD | Accept official mainland-China iCloud HTTPS endpoints; reject insecure/lookalike addresses; build 0.1.1 |
| A2 | Lead | Complete; live AI retry pending | A1 U1 I1 | src/ai, src/electron/preferences, src/ui, tests, scripts/e2e | Luna default and legacy migration; actionable safe AI failures; doubled input height; build 0.1.2 |

Git author identity uses Matthew Ren and the approved GitHub noreply address for public commits. First three agents started with exclusive directory ownership before a base commit could be made; calendar used an isolated agent/calendar worktree, subsequently removed after integration. The public repository is https://github.com/mren2222/MatthewPlanner. Original pre-publication history is retained on a local backup branch. Live providers require user-supplied credentials, which are not blockers for offline MVP.

Current validation: 83 unit/presentation/provider tests, typecheck, lint, production build and 0.1.2 packaged Windows Electron desktop flows pass. The packaged test asserts Luna as the initial model and chat input height of 126 CSS pixels (previously 63), with visual review confirming the composer stays visible. Development Vite/Electron shell and CSP nonce were verified for the initial MVP. The packaged app survives restart with tasks/events/activity/chat/proposals/history intact. OS DPAPI test uses a harmless key in isolated data. All automated regression test data is isolated in ignored test-results directories.

The user reported a rejected secure-address error and confirmed a mainland-China iCloud account. Three added regressions cover regional redirects, a China calendar home discovered from the global entry point, and safe rejection diagnostics. Tests also reject HTTP, deceptive suffixes, embedded credentials and nonstandard ports. A separate read-only diagnostic could not decrypt the existing credential file in its execution context, so no authenticated live calendar discovery was completed by the agent. The user subsequently confirmed iCloud works with 0.1.1. No real credential values were printed or committed.

The user reported the previous generic AI failure and requested Luna plus twice-height chat input. The precise original failure is unknown because its catch combined transport and validation errors. A2 changes safe failure reporting and accepts adjacent text fragments, sets Luna low reasoning, and increases the timeout and bounded output budget. Live API access has not yet been verified; mocked provider passes are not live model evaluations.

Manual configuration remaining: enter optional OpenAI API key/model and Apple Account app-specific password in Settings. Live account access is unverified without those credentials. Read imported events and publish explicit fixed events after choosing a calendar; edit imported events in Calendar and refresh. No automatic notification daemon or background scheduling service is included.
