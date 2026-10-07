# Core/Data brief

Owner: core_data native subagent. Own src/db, src/services/actions, src/core/validation, tests/data.test.ts. Shared types belong to Lead.

Accept when standard SQLite survives restart, batches validate/rollback/atomically persist, common changes undo with activities and audits, proposals apply atomically, and calendar import touches only selected FixedEvents. Never introduce Task calendar timing.
