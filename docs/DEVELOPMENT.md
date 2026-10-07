# Development and verification

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

Settings is the preferred key configuration method. Optional process environment values `OPENAI_API_KEY` and `PLANNER_AI_MODEL` are read only in main. `.env.example` documents them; `.env` files are ignored and are not automatically loaded.

## Architecture and validation

Electron main owns SQLite, OS-encrypted credentials, AI and CalDAV networking. The sandboxed React renderer receives only a typed preload API. All manual and AI mutations pass validated ActionService operations with revision checks, transaction rollback, audit before/after states, atomic disk persistence, and local undo. AI providers never import the database.

SQLite runs through sql.js to avoid native ABI/rebuild dependencies. The persistent file is ordinary SQLite, with schema version 2 and one main-process writer. Version 1 is upgraded while retaining a pre-v2 backup. Whole-file atomic persistence is appropriate for this personal application; very large databases should move to a native SQLite implementation.

Validation includes unit/presentation/provider tests, TypeScript, lint, production and development builds, and Windows desktop flows including restart persistence and DPAPI credential storage. Provider tests use mocked responses, including Gmail OAuth/state/PKCE, selected-email isolation, mainland-China iCloud discovery and incomplete-data recovery, Luna reasoning configuration and safe failure categories; no real provider credentials are in fixtures. Review findings and fixes are recorded in [review notes](REVIEW.md).

See [product](PRODUCT.md), [architecture](ARCHITECTURE.md), [contracts](CONTRACTS.md), [decisions](DECISIONS.md), [backlog](TASKS.md), and [acceptance examples](TEST_CASES.md).

Build a Windows installer with `pnpm package:installer`; see [installation](INSTALL.md).
