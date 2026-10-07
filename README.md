# Matthew Planner

0.2.1 adds a local Codex/connected ChatGPT Work input bridge, preserves longer clarification conversations, and records completed work that has no existing task. See [Work input setup](docs/WORK_INPUT.md). The computer must be connected and the app open; cloud-only chats cannot access local data. iCloud troubleshooting is deferred at the user's request.

A local-first Windows desktop planner. Flexible tasks have a **planned day and optional estimated duration**. Appointments have exact times and live separately as fixed events. Clear chat commands apply directly with undo; discussion and ambiguity leave the plan unchanged.

## Launch

- Portable application: `release/Matthew Planner 0.2.2.exe`.
- Application folder: double-click `release/win-unpacked/Matthew Planner.exe`. Keep the whole win-unpacked folder together.
- These are local, unsigned Windows x64 builds. No account or API key is required for local planning.

The fixed-only week overview sits above selected-day commitments and Todo, with next-day appointments beside them. Date headings contain only date/weekday. Duration is optional; priority and statistics are absent. One click completes a task and records local retrospective activity, another reopens it. Completed items move below active work. Daily Notes, past/future dates and earlier unfinished work are available. **撤销 / Undo** reverses the latest local batch.

Chat opens when needed. Without a key it is a limited offline interpreter. Examples: “Move Portfolio to Friday”, “DRI is done”, “portfolio今天不做了，明天吧”. Clear commands apply after validation without a second confirmation. Discussion and clarification do not apply actions. Old pending proposals remain accessible, with stale revision protection.

**回看 / Retrospect** shows local completed-activity time blocks, which can be edited or dragged. Automatically placed times retain their internal source without UI confidence labels. These records never upload to iCloud. No automatic task rescheduling or evening check-in is performed. See the [approved redesign](docs/REDESIGN.md) and [Gmail setup](docs/GMAIL_SETUP.md).

## Optional connections

In **Settings**, enter an OpenAI API key and a model supporting Responses structured output. The model is configurable; its initial value is `gpt-5.6-luna`. Version 0.1.2 also upgrades the previously saved `gpt-4o-mini` default to Luna. Subsequent explicitly saved model choices are respected. Luna requests use low reasoning effort, an 8,000-token output budget and a 60-second timeout. Configured chat sends bounded task/history/chat context to OpenAI with API response storage disabled. Calendar credentials are excluded and known secrets are redacted. See [AI behavior and limits](docs/AI.md).

For iCloud, save your Apple Account and app-specific password in Settings. The app automatically finds “事情” and refreshes at startup, every five minutes while open, and after resume/network recovery. Multiple same-name calendars require a one-time selection. Details are in [iCloud integration](docs/ICLOUD.md). Gmail requires a Desktop OAuth client and browser consent; see [Gmail setup](docs/GMAIL_SETUP.md).

Only **Publish** on an explicitly created fixed event can send a new appointment to iCloud. Flexible tasks and activity records have no calendar export path. Imported/published events are read-only in this MVP UI: edit them in Calendar and refresh. The provider separately implements guarded updates and deletes for future UI use. Recurring appointments are expanded for the past 7 and next 90 days; unsupported/malformed calendars fail the refresh while preserving the last successful snapshot. Live provider authentication has not been tested with your account.

Credentials are encrypted through Windows DPAPI using Electron safeStorage and stored outside SQLite. Saved keys/passwords are never returned to the renderer. Unavailable encryption refuses credential storage while local planning remains usable.

## Data and backup

The app stores `planner.sqlite` and encrypted `credentials.secrets` under `%APPDATA%/Matthew Planner`. The SQLite file contains tasks, events, activity, chat, proposals, revisions and audit history. Quit the app before copying it for backup. Credentials are tied to the Windows account; configure them again when moving to another PC. The portable executable still uses this local data directory. There is no hosted backend or automatic task cloud sync.

Tests use separate ignored directories under `test-results`; they do not seed or alter your regular planner data.

## Develop and verify

Requirements: Windows x64, Node 22.12+ and pnpm. This machine's existing bundled Node 24 and pnpm were used; no unrelated system configuration was changed.

```powershell
cd MatthewPlanner
pnpm install
pnpm exec install-electron
pnpm dev
```

`pnpm dev` launches Electron with Vite. Close the app and restart development mode after changing main/preload code; React edits refresh automatically.

```powershell
pnpm typecheck
pnpm lint
pnpm test
pnpm build
pnpm start
pnpm test:e2e
pnpm test:dev
pnpm package
pnpm test:packaged
pnpm package:portable
```

If pnpm is not on PATH in this Codex workspace, replace `pnpm` with:

```powershell
& 'C:\Users\Matthew\.cache\codex-runtimes\codex-primary-runtime\dependencies\bin\fallback\pnpm.cmd'
```

Settings is the preferred key configuration method. Optional process environment values `OPENAI_API_KEY` and `PLANNER_AI_MODEL` are read only in main. `.env.example` documents them; `.env` files are ignored and are not automatically loaded.

## Architecture and validation

Electron main owns SQLite, OS-encrypted credentials, AI and CalDAV networking. The sandboxed React renderer receives only a typed preload API. All manual and AI mutations pass validated ActionService operations with revision checks, transaction rollback, audit before/after states, atomic disk persistence, and local undo. AI providers never import the database.

SQLite runs through sql.js to avoid native ABI/rebuild dependencies. The persistent file is ordinary SQLite, with schema version 2 and one main-process writer. Version 1 is upgraded while retaining a pre-v2 backup. Whole-file atomic persistence is appropriate for this personal application; very large databases should move to a native SQLite implementation.

Validation includes unit/presentation/provider tests, TypeScript, lint, production and development builds, and Windows desktop flows including restart persistence and DPAPI credential storage. Provider tests use mocked responses, including Gmail OAuth/state/PKCE, selected-email isolation, mainland-China iCloud discovery and incomplete-data recovery, Luna reasoning configuration and safe failure categories; no real provider credentials are in fixtures. Review findings and fixes are recorded in [review notes](docs/REVIEW.md).

See [product](docs/PRODUCT.md), [architecture](docs/ARCHITECTURE.md), [contracts](docs/CONTRACTS.md), [decisions](docs/DECISIONS.md), [backlog](docs/TASKS.md), and [acceptance examples](docs/TEST_CASES.md).
