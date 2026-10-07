# Product

Matthew Planner plans flexible work by day and duration. A one-hour preparation task means one hour sometime that day. Exact appointments are separate FixedEvents. Daily views combine those two kinds of objects without turning tasks into calendar blocks.

MVP: task creation/editing/moving/completion/cancellation/notes, upcoming days, inbox and completed items, daily estimated totals, actual duration and confidence-tagged activity history, persistent AI chat, preview/apply/cancel proposals, manual and late-day review, SQLite persistence, audit trail and undo, explicit fixed events, secure configurable OpenAI and iCloud providers.

Natural language in English or Chinese should propose transparent changes. Ambiguous matches ask a question. A missed task without a replacement date asks whether to complete, move or cancel. Never silently roll work into tomorrow. Inferred history is optional, clearly labelled, and never exported.

Without API credentials the app works fully offline with a limited, explicitly labelled example interpreter. Live AI uses OpenAI only after configuration. Tasks remain on this PC; user-selected AI context is transmitted for configured requests. Calendar access needs credentials supplied by the user.

Excluded: accounts, teams, cloud task sync, mobile, exact task time blocking, recurring engine, ML estimates, email/Slack/Notion ingestion, gamification.
