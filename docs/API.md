# HTTP API

Base path: `/api/v1`. Responses use JSON except OAuth redirects and the empty
UED challenge close response. Authentication is an opaque, hashed server-side
session in an HttpOnly `ued_session` cookie. Every non-GET request must be JSON
and carry an `Origin` exactly matching `WEB_ORIGIN`; external integrations never
receive this application session.

Dates are ISO 8601 instants with an explicit offset. Calendar ranges overlap
when `startTime < toDate && endTime > fromDate`. IDs are UUIDs. A normal error
has shape `{ "error": { "code": "...", "message"?: "...", "details"?: [] } }`.

## Service and authentication

| Method | Path | Authentication | Purpose |
| --- | --- | --- | --- |
| GET | `/health` | No | Process liveness. |
| GET | `/ready` | No | Database-aware readiness. |
| GET | `/auth/config` | No | Enabled sign-in methods; never returns secrets. |
| GET | `/auth/me` | Student | Current public student profile/settings. |
| POST | `/auth/demo` | No, development only | Create an isolated labelled demo student. |
| POST | `/auth/logout` | Optional | Revoke the current server-side session. |

## Initial state

`GET /bootstrap?fromDate=<instant>&toDate=<instant>` returns the public user,
overlapping events/blocks, tasks, actionable suggestions plus bounded history,
notifications, safe integration status/cursors, and academic records. The range
defaults to seven days and cannot exceed 90 days.

The same response includes `agendaOverview`, calculated independently from that
calendar range. Its `today` collection covers every non-cancelled item that
overlaps the exact local calendar day in the student's configured IANA
timezone, including items that already ended earlier that day. `upcoming`
contains the next 12 scheduled items without an arbitrary date horizon, and
`past` contains the 12 most recently ended items. Events and task blocks are
returned separately in each collection; `asOf`, `dayStart`, and `dayEnd` make
the half-open time boundaries explicit.

Bootstrap `tasks` contains every active task plus the first 50 closed tasks
(`COMPLETED`/`CANCELLED`), without nested `scheduleBlocks`. `taskHistoryPage`
contains `{hasMore,nextCursor}` for closed history. `taskStats` contains
authoritative `{active,completed,cancelled}` counts, independent of loaded pages.

## Tasks and accepted schedule blocks

| Method | Path | Purpose |
| --- | --- | --- |
| GET | `/tasks/history?cursor=<opaque>&limit=50` | Page through closed tasks by updated time and ID, newest first. |
| GET | `/tasks/:id/schedule-blocks?cursor=<opaque>&limit=50` | Page through a task's non-cancelled sessions by start time and ID, newest first. |
| POST | `/tasks` | Create a pending task. |
| PATCH | `/tasks/:id` | Edit a pending task; scheduling fields require unscheduling first. |
| PATCH | `/tasks/:id/status` | Move among `PENDING`, `IN_PROGRESS`, `COMPLETED`, `CANCELLED`. |
| POST | `/tasks/:id/unschedule` | Cancel only future blocks without changing the task's current progress status. |

Task input: `title`, optional `notes`/`location`, `durationMinutes` (15–43200),
future `deadline`, `priority` (`HIGH|MEDIUM|LOW`), and `isSplittable`. Schedule
blocks are not directly writable; they are created atomically only when a
student accepts a valid task-plan suggestion.

Both pagination endpoints accept limits 1–100, default 50. History returns
`{tasks,page:{hasMore,nextCursor}}`; sessions return
`{blocks,hasFutureBlocks,page:{hasMore,nextCursor}}`. `hasFutureBlocks` checks
all scheduled sessions after server time, not just the current page. Opaque
session cursors are task-scoped. Invalid query values return 400; another
student's or a missing task returns 404. Continue with the returned cursor;
these are live pages rather than an immutable snapshot. The UI retains loaded
history across refreshes and explains that history search covers loaded rows.

## Events

| Method | Path | Purpose |
| --- | --- | --- |
| POST | `/events` | Create a confirmed personal/class/deadline event. |
| PATCH | `/events/:id` | Edit an owned event after conflict validation. |
| PATCH | `/events/:id/status` | Set `SCHEDULED`, `CANCELLED`, or `COMPLETED`. |

Event input: `title`, optional `location`, `startTime`, `endTime`, and
`eventType` (`CLASS|PERSONAL|DEADLINE`). Overlaps and configured travel buffers
are checked before writes. Cancelling a slot may generate a new task-plan
suggestion, never an automatic calendar mutation.

## Scheduling and decisions

| Method | Path | Purpose |
| --- | --- | --- |
| POST | `/scheduling/proposals` | Build and save a reviewable plan for `fromDate`–`toDate` (max 90 days). |
| POST | `/suggestions/:id/accept` | Recheck version, current time, deadline, duration and conflicts, then commit. |
| POST | `/suggestions/:id/reject` | Record the student's rejection without calendar changes. |

Acceptance is idempotent and serialized per student. `REVIEW` email evidence
cannot be accepted as a calendar action. A schedule/settings change expires
outdated task plans.

## Settings and notifications

| Method | Path | Purpose |
| --- | --- | --- |
| PATCH | `/settings` | Replace profile/routine preferences with validated values. |
| POST | `/notifications/read-all` | Mark all owned notifications read. |
| POST | `/notifications/:id/read` | Mark one owned notification read. |

Settings include `name`, `locale`, IANA `timezone`, active/break `HH:mm`,
`minBlockMinutes` (15–120), `travelMinutes` (0–120), optional `studyLocation`,
and `notificationsEnabled`. The break must lie wholly inside active hours.

## UED read-only integration

| Method | Path | Purpose |
| --- | --- | --- |
| GET | `/integrations/ued/readiness` | Public adapter readiness, without secret values. |
| POST | `/auth/ued/start` | Start a short-lived portal login challenge. |
| POST | `/auth/ued/submit` | Submit challenge ID, student ID, password and optional CAPTCHA. |
| DELETE | `/auth/ued/challenge` | Close the browser challenge and erase transient form state. |
| PATCH | `/integrations/ued/term` | Queue `CURRENT` or an explicit academic year/semester. |

The password is forwarded only for the current UED login attempt and is never
stored. A verified Playwright storage state is AES-256-GCM encrypted at rest.
Sync reads portal data. The first verified timetable snapshot for each term is
imported as fixed `SCHOOL_PORTAL` calendar Events; an occurrence discovered for
the first time only on a later snapshot, or a later room, time, status, or
cancellation change, remains an evidence-backed suggestion for the student to
approve. The integration never writes registration, grades, payments,
attendance, or timetable state to UED.

## Outlook integration

| Method | Path | Purpose |
| --- | --- | --- |
| GET | `/auth/microsoft/start` | Begin school-account sign-in with authorization code + PKCE. |
| GET | `/integrations/outlook/connect` | Link Outlook to the signed-in student. |
| GET | `/auth/microsoft/callback` | Validate state/browser binding, exchange code, verify Graph `/me`. |

Only `User.Read`, `Mail.Read`, and `offline_access` are requested. Refresh
tokens are encrypted per student. The worker reads `/me/messages` across the
mailbox with pagination and creates conservative Vietnamese/English change
suggestions. Graph continuation cursors and token state are server-only and are
never returned by the public integration endpoints.

## Integration operations

| Method | Path | Purpose |
| --- | --- | --- |
| GET | `/integrations` | Safe connection status, sync time and error code. |
| POST | `/integrations/:provider/sync` | Queue `UED` or `OUTLOOK` for background sync. |
| DELETE | `/integrations/:provider` | Revoke local encrypted credentials/session and disconnect. |

Disconnecting preserves academic records and events/blocks the student already
accepted. It fences in-flight workers so a late external response cannot
silently reconnect the integration.
