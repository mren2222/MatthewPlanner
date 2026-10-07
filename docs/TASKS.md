# Engineering backlog

| ID | Owner | Status | Dependencies | Files | Acceptance |
|---|---|---|---|---|---|
| B0 | Lead | In progress | None | scaffold/docs/core | Tooling, contracts, Git scaffold, boot |
| D1 | Core/Data agent | Ready | B0 | src/db, src/services, core/validation, tests/data | SQLite CRUD, validated transactions, audit, undo, restart tests |
| A1 | AI agent | Ready | B0 | src/ai, tests/ai | Offline examples, live structured API boundary, clarification, no DB access |
| U1 | UI agent | Ready | B0 | src/ui | Day/duration CRUD, events, chat proposals, review, activity, settings |
| C1 | Calendar agent | Ready | B0 | src/calendar, tests/calendar, docs/ICLOUD | CalDAV discovery/read/explicit writes, secure secrets, mock tests |
| I1 | Lead | Ready | D1 A1 U1 C1 | src/electron/scripts | IPC/security/integration, packaged app, desktop flows |
| R1 | Fresh reviewer | Ready | I1 | review | Security and correctness review, high findings fixed |
