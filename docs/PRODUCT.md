# Product

Matthew Planner plans flexible work by day and duration. A one-hour preparation task means one hour sometime that day. Exact appointments are separate FixedEvents. Daily views combine those two kinds of objects without turning tasks into calendar blocks.

0.2.0: fixed-only week overview; selected-day appointments and Todo beside next-day appointments; optional duration and no visible priority/statistics; one-click completion/reopen and editable Notes; local retrospective calendar; direct clear chat commands with undo; automatic “事情” iCloud reading; Gmail readonly connection and selected-email extraction. SQLite persistence, audit and calendar isolation remain foundational. See [approved redesign](REDESIGN.md).

Natural language in English or Chinese returns validated actions. Clear commands apply directly; discussion and ambiguity do not mutate. Never silently roll work into tomorrow. Completion automatically creates a local retrospective time block under the user's approved convention; internal confidence/source is retained without UI confidence labels. History is never exported to iCloud.

Without API credentials the app works fully offline with a limited, explicitly labelled example interpreter. Live AI uses OpenAI only after configuration. Tasks remain on this PC; user-selected AI context is transmitted for configured requests. Calendar access needs credentials supplied by the user.

Excluded: teams, cloud task sync, mobile, exact task time blocking, ML estimates, Slack/Notion ingestion, Gmail sending/deletion and ChatGPT-history access. No hosted backend.
