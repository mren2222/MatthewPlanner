# Independent review

## Lead integration review of 0.2.3

Moved the existing selected-day fixed-event renderer and Add control to the
right column above next-day commitments. Existing start-time prominence,
meeting links, event details and explicit publishing controls are retained.
Changing the selected day still uses that day's appointments and the following
day. No entity mutation or calendar/Work/provider logic is changed. The user's
palette request is discussion-only; CSS changes are heading selector reuse and
spacing, without any color value changes.

Typecheck, lint, build, all 119 unit regressions and the isolated development
and packaged desktop workflows pass.
Updated desktop assertions verify the two commitment sections share the right
column in the requested vertical order and no fixed-event rows remain in the
left column. Packaged checks also verify selected-date navigation, meeting
links and the Add control in the relocated section. Lead visually reviewed the new layout. Release verification is
tracked in TASKS.md.

## Lead integration review of 0.2.2

Presentation-only changes follow the user's explicit request: a single Todo
list with active then checked completed rows and normal text, 184px minimum
Notes with automatic content/width resizing, and a right-column Other Todo card
under next-day commitments. No calendar, database/service or shared contract
changes are introduced. Existing completion/reopen and Undo remain intact.
Past selected-day tasks are omitted from the previous-work group to avoid
duplicate completion/edit controls for the same task.

Development and packaged desktop checks verify row order, checked state, absence of strike-through and
separate completion controls, Notes growth/no-inner-scroll/shrink/reload, and
right-card geometry using isolated data. ResizeObserver ignores height-only
notifications to avoid self-triggered resizing loops. Type/lint/build and the
desktop workflows pass, along with all 119 regressions. Lead visually reviewed 1440px and 960px
screens: colors and independent chat scrolling are retained. Packaged release
validation is recorded in TASKS.md. The user's normal plan data is not altered.

## Lead integration review of 0.2.1

Confirmed root cause of the supplied conversation: a six-message/600-character projection dropped original company/time facts and pasted Notes. The larger bounded, redacted projection retains the reported sequence; model instructions require using earlier facts and never requesting user-supplied IDs. create_completed_task is Lead-owned and creates/completes through the existing transaction/audit/undo path, deduplicating same-title/day repeats. Automated payload checks are not live model-quality proof.

The local Work/Codex bridge has no HTTP listener, provider writes, credential export or direct DB-writing CLI. Main serializes inbox handling with existing commands, sanitizes actions/source text and uses canonical validation. Snapshot excludes settings and chat/audit bodies. Revision checks reject stale writes. The application commits delivery receipts atomically with changes; retries survive restart and cannot replay an undone action. Changed payloads under reused IDs are rejected. Wire fingerprints prevent the CLI from mistaking an old result for a changed request's success. Invalid/malformed/oversized requests fail safely. Imported events remain read-only and completion never creates a CalendarProvider object.

119 unit regressions, type/lint and the production build pass. Both development and packaged CLI-to-Electron workflows cover delivery, repeat safety, credential redaction and Undo in isolated data, in addition to existing UI/restart checks. Account-side Work Cloud local connection and live AI remain user-side checks. iCloud debugging was explicitly deferred; this release makes no calendar-provider change. Portable packaging is tracked in TASKS.md.

## Lead review of approved 0.2.0 redesign

Shared contracts and ownership were updated by Lead. 108 regressions, typecheck, lint, production build and isolated development/packaged desktop workflows pass. No agent delegation or authenticated live provider test was performed in this iteration.

Review corrections: constrain chat scrolling to its own panel and grid row; do not claim actions were applied when discussion/clarification suppressed them; idempotent completion and reversible generated activity; preserve independent activity on reopen; keep unchanged calendar imports from churning revision/audit; allow missing read-only ETags and optional failed DAV properties while preserving conditional-write requirements; recover missing object data without treating it as deletion; retain source/thread metadata across email edits; reject email completion/unrelated actions atomically; persist processed IDs with undo. UI/AI context shows the selected calendar while retaining other cached collections in storage.

All-day events preserve their date representation. Local completion history uses internal source/confidence but plain time labels per user preference. Main still owns database, secrets, provider networking and secure browser links. No task/activity reaches CalendarProvider. Selected-email text is bounded/redacted and is not trusted as instructions. OAuth uses loopback/state/PKCE and only Gmail readonly. Provider exception details remain suppressed.

Limitations: Gmail needs the user's own Desktop OAuth setup and consent; live AI and the newly reported iCloud failure still need user-context verification. Imports are limited to selected messages and a recent search window; duplicate/thread matching is conservative and ambiguous changes remain unprocessed. Automatic iCloud refresh runs only while open. Prior MVP review below is historical.

A fresh native reviewer inspected domain boundaries, persistence, AI proposals, secrets, Electron/IPC and the isolated calendar implementation. No flexible-task calendar synchronization or direct AI database mutation was found.

| Finding | Resolution | Evidence |
|---|---|---|
| Tasks outside current week become unreachable | Added arbitrary Planning day picker and earlier unfinished work section; dates stay unchanged | Desktop flow covers overdue display and tomorrow navigation |
| Same-proposal inferred activity intervals can overlap | Validate against both existing history and other proposed intervals; inferred source cannot masquerade as exact | AI rejection regression test |
| Preview omits changed values/timestamps | Show all create/update fields and full historical start/end dates/times | Presentation test and desktop previews |
| Pasted known credential can enter task/audit text | Main sanitizes user-content action fields before validation and persistence; preserves explicit undefined clearing | Real IPC desktop test saves key, pastes it into task note, asserts snapshot/audit has no key |
| Calendar retry can duplicate successfully-created events | Stable resource URI/UID and exact-field reconciliation after create 412; mismatched content fails safely | Mock covers server save followed by lost response and idempotent retry |

Lead visual verification also found chat autoscroll shifting the full app shell. Fixed independent panel scrolling and constrained grid/flex heights; desktop test asserts window.scrollY is zero with a long chat history.

Final source checks: 68 tests, TypeScript and lint passed. Packaged Matthew Planner.exe passed the same desktop/restart workflow as the development build. Calendar read body timeouts remain active until complete response consumption. Every reported issue was addressed with focused validation.

Live OpenAI/iCloud calls require user credentials and have not been attempted by the test suite. Providers are exercised with mocked responses; Windows credential storage is exercised with a harmless test key in an isolated data directory.
