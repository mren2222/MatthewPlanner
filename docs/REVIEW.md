# Independent review

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
