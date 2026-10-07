# Use Codex or ChatGPT Work as the planning input

Version 0.2.1 provides a local file inbox. A connected task translates the user's
natural-language instructions into ProposedAction objects. Electron applies them
through ActionService with revision checks, audit history, transactions and Undo.
There is no network server, hosted backend or direct database-writing script.

## Connection requirements

The computer must be online and Matthew Planner must be open. For phone access,
use a supported Codex host connection, or a new ChatGPT Work conversation with
Local computer access with Work Cloud enabled. A cloud conversation without an
approved connected computer cannot access this bridge. Availability depends on
account/workspace settings. Messages sent while offline can be retained in the
conversation; this app does not automatically retrieve them or poll ChatGPT.
Continue the connected task to apply them after reconnecting.

Official guides: https://learn.chatgpt.com/docs/get-started-with-work and
https://learn.chatgpt.com/docs/remote-connections .

## Connected agent workflow

1. Read AGENTS.md and this file. Do not edit application code, the database or
   credential files for routine planning.
2. From this repository run `node scripts/planner.mjs snapshot`. This reads
   `%APPDATA%\Matthew Planner\bridge\snapshot.json`, containing the current
   revision, local dates/timezone, tasks, fixed events, activities and day notes.
   It contains no settings, authentication values or full chat/audit history.
3. Translate only the user's clear instructions into canonical ProposedAction
   objects from src/core/types.ts. Read preceding conversation turns to retain
   appointment names, dates, times, durations and timezone. Never ask the user
   for internal IDs: resolve IDs from the snapshot. Ask once about genuinely
   missing or ambiguous required details. Discussion does not mutate.
4. Write a request JSON file in the ignored `.planner-bridge/` directory:
   `{ "id": "a-fresh-UUID", "expectedRevision": 3, "sourceMessage": "the user's instruction", "actions": [...] }`.
   Do not put credentials into this file or sourceMessage.
5. Run `node scripts/planner.mjs apply --file .planner-bridge/request.json`.
   Wait for a result with status `applied`. Verify the resulting snapshot before
   reporting success. If stale, read a fresh snapshot, reconsider the changes,
   and submit a new request ID. A timeout is pending delivery, not proof of
   failure: inspect the receipt and reuse the original ID for an exact retry.
6. Report the actual changes concisely. Undo is available in the application.

Grant the connected task access to this repository and the **bridge subfolder**
`C:\Users\Matthew\AppData\Roaming\Matthew Planner\bridge`. It does not need
access to credentials.secrets. The CLI accepts `--bridge-dir` for isolated tests.
The normal app uses its own userData bridge path.

Flexible Todo items carry dates and optional durations only. Record completed
work using complete_task for an existing task or create_completed_task for
clearly identified missing work. Completed blocks remain local. Fixed events
require explicit dates and true appointment times; creation is local. This
bridge cannot publish to iCloud. Use the app's explicit publishing action.
Never claim to have read mail or created appointments from unavailable email.

## Delivery and isolation

The inbox uses atomic file rename. The main process serializes its consumption
with other mutations. Receipts are committed in the same SQLite transaction as
the changes. Exact retries, including after restart or Undo, never repeat the
operation. Reused IDs with different payloads and stale revisions are rejected.
This is a same-Windows-user local interface, not a remotely exposed endpoint.
Imported calendar events remain read-only. Every request goes through the same
canonical validation and known-credential redaction as the app's other inputs.

## Dialogue repair

The AI previously received only six messages with 600 characters per message.
Repeated questions could drop appointment times and long pasted plans lost
their Notes. The context now retains up to 40 messages within a 48,000-character
budget, with user messages up to 16,000 characters. The provider is instructed
to combine earlier facts and ask all genuinely missing required details once.
create_completed_task avoids demanding an internal task ID when completed work
was never entered. Regressions verify the user-reported clarification sequence
is present in the API payload; they are not a live model quality evaluation.

The user asked to defer the current iCloud read failure. No calendar-provider
change or authenticated live synchronization claim is made in this release.
