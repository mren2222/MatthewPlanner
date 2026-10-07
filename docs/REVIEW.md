# Independent review

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
