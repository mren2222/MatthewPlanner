# iCloud Calendar

## Account setup

1. Enable two-factor authentication on your Apple Account.
2. At [account.apple.com](https://account.apple.com/), open Sign-In and Security → App-Specific Passwords and generate a password named Matthew Planner.
3. In planner settings, enter your Apple Account email and that app-specific password, save, and choose a discovered calendar.
4. Refresh the calendar to import its fixed events. Publish a local fixed event only through its explicit publish command.

Apple continues to document app-specific passwords for third-party calendar access and requires two-factor authentication. Apple also offers account authorization for supported third-party apps; this generic CalDAV implementation uses the documented app-specific-password path. Changing your main Apple Account password revokes existing app-specific passwords; generate a replacement if sign-in stops working. See [Apple's current account authentication guide](https://support.apple.com/en-us/102654), verified October 7, 2026.

## Credentials and transport

Credentials entered in Settings are sent through the narrow bridge to Electron main for encrypted storage. Saved secrets are never returned to the renderer and never enter planner prompts, SQLite or audit history. The application credential store uses Electron `safeStorage`, whose Windows implementation uses DPAPI. Encryption must be available before a secret is saved. DPAPI protects against other Windows users but does not protect against every application running as the same user; see [Electron safeStorage security semantics](https://www.electronjs.org/docs/latest/api/safe-storage).

`ICloudCalendarProvider` accepts `{ username, password, timezone?, fetch? }`. Production passes credentials from the main-process credential store; tests inject a mock `fetch`. The endpoint is fixed at `https://caldav.icloud.com/`. Discovery follows well-known service redirects, the current-user-principal property, and the calendar-home-set property through tsdav. Every request and redirect is checked for HTTPS and an allowed iCloud host before sending credentials. Arbitrary account server URLs, embedded URL credentials, alternate ports and non-iCloud redirects are rejected. Requests and DAV response-body reads have a 20-second timeout. HTTP and transport errors use safe messages rather than returning raw error details. Do not enable dependency debug logging in production.

Version 0.1.1 also permits HTTPS discovery, collections and event resources on `icloud.com.cn` and its subdomains for mainland-China accounts. Apple lists `*.icloud.com.cn` as iCloud services in China in its [enterprise network documentation](https://support.apple.com/en-us/101555), checked October 7, 2026. Ports other than 443, HTTP and lookalike suffixes remain blocked. Rejected-address errors report only protocol and host, without credentials, account paths or query values. An app-specific password alone could not resolve the earlier missing-domain allowlist error.

The [tsdav maintainer README](https://github.com/natelindev/tsdav/blob/main/README.md) documents authenticated DAV clients and custom fetch support; [tsdav's current quick start](https://tsdav.vercel.app/) demonstrates the iCloud CalDAV endpoint and calendar discovery. This implementation follows the installed tsdav 2.4.0 API. The CalDAV discovery and resource model comes from [RFC 4791](https://www.rfc-editor.org/rfc/rfc4791.html) and well-known service discovery from [RFC 6764](https://www.rfc-editor.org/rfc/rfc6764.html).

## Snapshot and recurrence policy

`listEvents(calendarId)` returns one atomic snapshot of the selected account calendar's VEVENT objects. The REPORT has no date filter, filename filter, or incremental sync token. Ordinary non-recurring events are returned regardless of date, so a caller may remove stale imported objects only after the entire operation succeeds. An empty valid calendar returns an empty snapshot. Missing calendar data or ETags, failed DAV properties, invalid event times, duplicate resources, unsupported components or a parse failure reject the entire refresh. The caller must keep the previous snapshot after any rejection.

Recurring events are expanded locally with ical.js. RRULE, RDATE, EXDATE and explicit RECURRENCE-ID overrides use the library's recurrence machinery. The snapshot includes recurring instances overlapping the period from 7 elapsed days before refresh through 90 elapsed days after refresh. Instances outside this horizon intentionally disappear from a later imported snapshot. Occurrence identifiers use the resource URL plus a recurrence anchor fragment; moved exceptions retain the same identity. Cancelled events and cancelled exceptions do not appear. Explicit exceptions moved into the horizon from anchors outside it are included. Imported recurring events are read-only in the planner; edit the series in Calendar and refresh.

Each resource must contain one recurrence master and optional exceptions with its UID. Detached exception-only resources and period-valued RDATE fail the refresh. Imported events require positive duration: invalid or zero-duration timed objects fail rather than disappearing silently. All-day dates become midnight-to-midnight instants in the configured account timezone, retaining DST changes. UTC and embedded VTIMEZONE definitions are honored. IANA TZIDs without an embedded definition and floating times use Intl timezone conversion. Unsupported custom TZIDs without a VTIMEZONE fail the refresh. Spring-forward wall times that do not exist are rejected; ambiguous fall-back wall times use the offset selected by Intl conversion. All-day presentation currently uses the fixed-event timestamp representation rather than a separate all-day flag. Calendar times, durations and recurrence rules follow [RFC 5545](https://www.rfc-editor.org/rfc/rfc5545.html); the [ical.js repository](https://github.com/kewisch/ical.js) documents parsing and recurrence support.

Safety limits are 20,000 calendar resources, 50,000 returned instances and 100,000 recurrence iterator steps per series. A limit failure rejects the snapshot, keeping previous imports. Very old high-frequency series may exceed the iteration budget. A live calendar remains unverified until a user supplies their own account and performs a refresh; automated tests never contact iCloud or contain working credentials.

## Explicit fixed-event writes

The provider boundary strictly accepts `FixedEvent`, rejects unknown fields, and rejects Task objects even if they are augmented with event timestamps. Flexible tasks never cross this boundary.

- `createEvent(calendarId, event)` accepts a local fixed event only and derives a stable UID/resource filename from its local ID, creating with `If-None-Match: *`. A retry after a lost response uses the same resource. On HTTP 412 it reads that resource and reconciles only an identical UID and unchanged explicit fields; different content is a conflict. It returns the local identifier plus iCloud source, calendar/provider, resource URL and the server ETag when supplied.
- `updateEvent(calendarId, event)` accepts an imported single event with its calendar/resource/ETag metadata. It reads the current resource, verifies the ETag, preserves unrelated iCalendar properties, changes the explicit fields, and sends `If-Match`.
- `deleteEvent(calendarId, event)` also reads and verifies the resource before sending `If-Match`. It rejects recurring resources, including a forged occurrence with its fragment removed.

Updates and deletes reject occurrence fragments, cross-calendar resource URLs, missing ETags and unsupported recurrence structures. A 412 response means another client changed the object: refresh and retry. When a successful PUT does not return an ETag, its result has no ETag and must be refreshed before another write. UTC serialization preserves absolute start/end instants and writes the original IANA display timezone in `X-MATTHEW-TIMEZONE`. ical.js handles line folding and text escaping. Imported events are edited in the Calendar application in the current UI; local fixed events have a separate explicit publish action.

## Validation

Mock HTTP tests cover actual tsdav discovery, complete REPORT snapshots (including resources without `.ics` suffixes), fixed-event isolation, escaping, UTC/floating/all-day/VTIMEZONE handling, recurrence exceptions, atomic parse failures, conditional writes, unsafe redirects, safe errors and timeouts. No live network credential test runs automatically.
