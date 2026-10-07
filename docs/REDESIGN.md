# Approved 0.2.0 redesign

## Approved 0.2.2 presentation refinement

The user requested this follow-up on 2026-10-07. Completed items stay in the
selected day's single Todo list after active items, with a checked control and
ordinary text. Remove the separate completed heading/collapse control and
strike-through. Completion/reopen/local-history/Undo behavior is unchanged.

Daily Notes starts at 184px (twice the former approximately 92px control) and
grows/shrinks with content, retaining that minimum. Loaded notes and width
changes resize too; there is no inner scrollbar. Existing save/draft behavior
and validated day-note persistence are retained.

Put previous unfinished work and undated tasks together in an Other Todo card
beneath next-day commitments in the right column. The card shows the two
expandable groups and retains completion/edit/move controls. Viewing a past day
does not duplicate that day's active items in the previous-work group. Narrow
layouts stack the complete right column beneath the selected day.

Lead owns all changes. No task/event/date mutation, calendar change or new
contract is part of this presentation update. The specification below records
the earlier release; this refinement supersedes its separate completed section.

The user approved implementation after a Chinese-language design discussion on 2026-10-07. Lead owns integration, shared contract changes and all changed directories for this iteration. No new agent delegation was requested.

## Workspace

- Keep the natural green/off-white palette, with darker text, larger body type and clearer controls.
- One window: Arrange and Retrospect navigation, a collapsible chat panel, fixed-only week overview with weekdays/full week and week navigation.
- Below the overview: a wider selected-day column (date/weekday only, fixed commitments first, Todo, completed tasks, daily Notes); a narrower next-day fixed-event column. Stack the next-day column when space is limited.
- Tasks have optional duration and no execution order or scheduled times. Do not expose priority or workload/progress/actual statistics. Preserve existing priority metadata for compatibility.
- One click completes; another reopens. New tasks append to the active list, completed tasks appear below it. Earlier unfinished work remains on its original planned day.
- Expanded calendar has time columns, all-day events, overlapping lanes and a current-time line. Retrospect displays editable/draggable local activity blocks, optionally overlaying commitments.

## Direct actions and local history

Clear chat commands apply through validated ActionService operations, transactions, revision checks and audit history. Discussion and clarification return no actions. Legacy pending proposals remain accessible. No automatic evening check-in.

Completing a task also records an activity. Explicit supplied start/end are preserved; otherwise the completion service uses message/action time and stated duration, task estimate or a 30-minute default, locating a local retrospective interval outside known occupied intervals. Internal inferred source/confidence is retained; the UI displays ordinary time ranges without confidence labels. A supplied past completion date is supported. Placement is a recollection aid, never a scheduled Task or a CalendarProvider object.

Repeat completion is idempotent. Reopen removes completion-generated activity only, preserving independently recorded work. Undo restores tasks and activity together. Editing or dragging an activity updates its task's activity projection and is audited/reversible.

Schema 2 adds day notes and processed-email records. Version 1 databases upgrade without dropping existing rows and retain a pre-v2 backup beside the SQLite file. Newer schema versions are rejected before modification. Unchanged calendar refreshes do not increment revision or append duplicate audit entries.

## Calendar

Automatically locate the unique “事情” calendar and save its stable ID. If several have that name, select once in Settings. Startup, five-minute intervals, resume and renderer online recovery trigger serialized refreshes while the app is open; there is no closed-app daemon.

Refresh accepts valid event data when optional DAV properties are unavailable or ETags are absent. Missing REPORT data can be recovered through an authenticated GET of the same validated calendar object URL. Conditional writes still require ETags. Any unrecoverable object error preserves the last complete imported snapshot; never treat partial reading as deletion. Secure redirects continue to allow only official iCloud global/China HTTPS endpoints.

Only explicit fixed-event publishing crosses CalendarProvider. Todo and activity never synchronize. Imported events remain locally read-only.

## Email

Gmail uses system-browser Desktop OAuth with loopback binding, PKCE, state validation, a timeout and only `gmail.readonly`. Refresh token and optional client secret are OS-encrypted in main. No Gmail send/delete/modify methods exist.

User-configurable Gmail search defaults to recent job-search terms. Listing stays in main memory and renderer review. Only selected messages are sent to AI, in bounded untrusted-content input. Text/calendar attachments are read within size/count limits. Source links and thread IDs are retained on imported entities.

Extraction can create local tasks/events, or update/cancel entities belonging to the same mail thread. Completion/history and unrelated mutations are rejected. Same-title/time duplicates are skipped; same-thread reschedules update local events. Processed message IDs persist transactionally with imported actions, and undo permits reprocessing. Uncertain extraction remains unprocessed and reports a clarification.

Actual Gmail access requires the user's Google Desktop OAuth client configuration and browser consent. Mocked OAuth/API tests are not authenticated live verification. Live AI and the user's latest iCloud failure remain to be verified in the user's normal app context.
