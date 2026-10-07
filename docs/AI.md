# AI planner

Main calls `createPlannerReply(message, context, { apiKey, model })`. The AI module has no database dependency and returns proposals only. Main persists a pending proposal with its base revision; approved proposals pass ActionService validation again. `reviewToday(context)` is a deterministic check-in with no mutation or automatic rescheduling.

Without a key the clearly labelled offline helper recognizes a limited set of Chinese/English commands: task completion, named multi-task completion, explicit moves, Amazon preparation by day and duration, actual duration, and missed-task clarification. It is not a full AI model. Ambiguous matches ask for a specific task; unsupported commands ask for clarification. Stated work duration records activity without assuming completion. Estimates are never substituted for actual durations. Offline historical reconstruction is intentionally omitted; exact/approximate/inferred activity remains supported by the domain and manual UI.

The live provider uses the OpenAI Responses endpoint with `text.format` strict JSON schema and `store:false`. The model is supplied from Settings, with no hardcoded model in core/AI. Strict wire-schema nullable optional fields are stripped, then the shared core action validator and context ID checks reject malformed proposals. Failed, refused, incomplete, or malformed responses produce no actions and a generic message; keys, response bodies, and provider exceptions are never logged or echoed. The optional `fetch` injection is for main-process tests.

Only a bounded projection is sent: up to 80 relevant tasks, 30 upcoming fixed events, 30 activity records, 30 minimal audit entries, and 6 recent messages. Text fields and user input have length limits and redact recognizable credentials. Audit before/after snapshots and calendar credentials are excluded. Treat task text and chat history as untrusted input. Using a configured live provider sends the selected planning data and request to OpenAI; offline mode remains local.

Inferred historical times may be proposed by live AI only when explicitly requested, safely ordered, and free of conflicting fixed events/activity. They must carry `inferred` confidence and `ai_inferred` source and never become fixed calendar events. Main's validated action service remains authoritative.

References: [OpenAI Structured Outputs](https://developers.openai.com/api/docs/guides/structured-outputs), [Responses API](https://developers.openai.com/api/reference/resources/responses/methods/create).
