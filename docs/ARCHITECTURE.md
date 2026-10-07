# Architecture

Electron main owns SQLite, filesystem, secrets, AI networking and calendar networking. React renderer is sandboxed with nodeIntegration disabled and contextIsolation enabled. A bundled preload exposes only typed PlannerAPI methods; no generic IPC, filesystem or SQL API. Main validates sender identity and all input.

Domain contracts are independent of Electron and React. SQLite uses sql.js (real SQLite in WASM), loaded once in main; mutation batches are transactions and the database is exported to an atomic replacement on disk before success is returned. Single-instance Electron prevents concurrent writers. Database and encrypted secrets live in app.getPath('userData'). No external backend.

Core/data module provides store, migrations, repositories and ActionService. AI providers receive a bounded PlannerContext without credentials, return PlannerReply, and have no storage dependency. Main stores a pending Proposal with revision, validates actions, and requires renderer approval. ActionService revalidates at apply time and rejects stale revisions. Audit stores before/after snapshots, source and batch; undo reverses the latest applicable local batch including activities.

CalendarProvider handles only FixedEvent. iCloud adapter discovers CalDAV collections and reads selected events. Explicit publish is separate from local creation. Imported events carry external identifiers and etags. Secure credentials use Electron safeStorage on Windows (DPAPI); fail closed if encryption is unavailable. Credentials are never returned to renderer or included in context.

Lead owns Electron/IPC/build/contracts. Agents own data, AI, UI and calendar directories and their dedicated tests. Isolated standard Git worktrees are used after the initial shared scaffold commit, then reviewed and cherry-picked into main.
