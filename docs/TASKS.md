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
| U2 | Lead | Complete | U1 A2 | src/ui, scripts/workspace-e2e | Fixed-only week, selected-day Todo + next-day events, contrast, optional duration, collapsible chat |
| D2 | Lead | Complete | D1 U2 | core, db, services, tests/redesign | Schema 2 migration/backup, one-click completion/reopen, local activity placement/edit/drag, Notes, atomic undo |
| A3 | Lead | Complete; live model retry pending | A2 D2 | ai, services/chat-policy, main | Clear commands apply with undo; discussion/clarification read-only; repeated completion idempotent |
| C3 | Lead | Complete; live error retry pending | C2 U2 | calendar, main, tests/calendar | Automatic “事情” selection/refresh; missing REPORT recovery; optional ETag reads; failure preserves cache |
| E1 | Lead | Complete; user OAuth configuration/consent pending | A3 D2 | mail, main, preload, UI, tests/mail | Gmail readonly PKCE/state flow; selected email extraction, sources, dedup/thread changes, undo |
| I2 | Lead | Complete; 0.2.0 Windows package | U2 D2 A3 C3 E1 | scripts, docs, release | Type/lint, 108 tests, desktop/dev/packaged flows, visual/integration review |

Git author identity uses Matthew Ren and the approved GitHub noreply address for public commits. First three agents started with exclusive directory ownership before a base commit could be made; calendar used an isolated agent/calendar worktree, subsequently removed after integration. The public repository is https://github.com/mren2222/MatthewPlanner. Original pre-publication history is retained on a local backup branch. Live providers require user-supplied credentials, which are not blockers for offline MVP.

Current validation: 108 tests, typecheck, lint, production build and 0.2.0 development/packaged desktop flows pass. Coverage includes OAuth state/PKCE, selected-email isolation and dedup, migration, direct chat/discussion, one-click completion/reopen/undo, Notes, local history editing/dragging, next-day fixed events, expanded week, failed sync preservation, independent scrolling, secure links/DPAPI and restart persistence. Visual review covers normal and 960px widths. All test data is isolated in ignored test-results directories; normal user data was not opened during verification.

The user reported a rejected secure-address error and confirmed a mainland-China iCloud account. Three added regressions cover regional redirects, a China calendar home discovered from the global entry point, and safe rejection diagnostics. Tests also reject HTTP, deceptive suffixes, embedded credentials and nonstandard ports. A separate read-only diagnostic could not decrypt the existing credential file in its execution context, so no authenticated live calendar discovery was completed by the agent. The user subsequently confirmed iCloud works with 0.1.1. No real credential values were printed or committed.

The user reported the previous generic AI failure and requested Luna plus twice-height chat input. The precise original failure is unknown because its catch combined transport and validation errors. A2 changes safe failure reporting and accepts adjacent text fragments, sets Luna low reasoning, and increases the timeout and bounded output budget. Live API access has not yet been verified; mocked provider passes are not live model evaluations.

User-side verification remaining: retry current iCloud account with automatic “事情” sync; configure a Google Desktop OAuth client and complete Gmail browser consent; retry configured live AI. Mocked provider passes do not establish authenticated live access. Imported events remain read-only; publish explicit local fixed events separately. No closed-app synchronization daemon or ChatGPT-history integration is included. See REDESIGN.md and GMAIL_SETUP.md.
