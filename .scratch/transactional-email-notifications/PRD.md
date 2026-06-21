# PRD: Transactional Email Notifications

**Status:** ready-for-agent  
**Feature slug:** transactional-email-notifications  
**Branch context:** `experiment` (email notification layer on Supabase-backed `main`)  
**Related docs:** `CONTEXT.md`, `docs/adr/0001-transactional-email-notifications.md`

---

## Problem Statement

When a user pledges for tickets, gives away tickets, or an event greenlights, they have no confirmation outside the app. If they close the browser, miss the success screen, or want a record of what happened, there is nothing in their inbox. Organisers and attendees also have no automated signal when an event crosses its hype threshold and becomes greenlit — a moment that changes payment expectations and event status for everyone with active tickets.

The prototype already captures payment at pledge time and mutates bookings in Postgres, but communication is entirely in-app. Users need trustworthy transactional emails that use correct domain language (pledge, give-away, greenlit — not cancellation/refund/backers) and that never block or roll back the underlying booking action if email delivery fails.

## Solution

Add a backend transactional notification layer that sends branded HTML emails via Resend when three domain events occur:

1. **Pledge confirmed** — after a successful pledge; confirms payment capture and explains refund-if-not-greenlit.
2. **Tickets given away** — after a user gives away one or more active tickets; confirms quantity released and that no refund was issued.
3. **Event greenlit (fan-out)** — when an event transitions to greenlit; emailed to every user with at least one active ticket on that event.

Delivery is fire-and-forget: the pledge, give-away, or greenlight mutation always succeeds even if Resend is unavailable. Each attempt is logged to a `notification_logs` table with status `sent`, `mock_sent`, or `failed`. Local development uses mock mode (console preview); shared staging redirects all mail to a team override inbox.

## User Stories

### Pledge flow

1. As a **user**, I want to receive an email immediately after I pledge for tickets, so that I have a record of my booking even if I leave the app.
2. As a **user**, I want the pledge email to state that my payment was captured now, so that I understand money has left my account at pledge time.
3. As a **user**, I want the pledge email to explain that I will be refunded if the event does not greenlight by the deadline, so that I understand the risk before the deadline passes.
4. As a **user**, I want the pledge email to show event title, ticket quantity, price per ticket, and total amount, so that I can verify the charge matches what I selected at checkout.
5. As a **user**, I want the pledge email to show the event funding deadline, so that I know when the greenlight decision will be made.
6. As a **user**, I want the pledge email to use party.fun branding consistent with the app, so that I trust it is legitimate and not phishing.
7. As a **user**, I want my pledge to succeed even if the email fails to send, so that a third-party outage does not block my ticket purchase.
8. As a **user**, I want a link in the pledge email to return to my pledges in the app, so that I can review my bookings quickly.

### Give-away flow

9. As a **user**, I want to receive an email when I give away tickets, so that I have confirmation that those tickets were released back to the pool.
10. As a **user**, I want the give-away email to state how many tickets I gave away, so that partial give-aways are clearly distinguished from full give-aways.
11. As a **user**, I want the give-away email to make clear that no refund was issued, so that I do not expect money back for a voluntary release.
12. As a **user**, I want the give-away email to avoid the word "cancelled" or "refund", so that I do not confuse a give-away with an event-level cancellation.
13. As a **user**, I want my give-away to succeed even if the email fails to send, so that ticket release is not blocked by email outages.
14. As a **user**, I want a link in the give-away email to browse other events, so that I can find something else to attend.

### Greenlit flow

15. As a **user with active tickets**, I want to receive an email when an event I pledged for becomes greenlit, so that I know the party is officially on.
16. As a **user with active tickets**, I want the greenlit email to show the event date, time, and location, so that I can add it to my calendar.
17. As a **user with active tickets**, I want the greenlit email to reference tickets pledged (not "backers" or unique users), so that the messaging matches how hype works in the app.
18. As a **user who triggered the threshold-crossing pledge**, I want every other active ticket holder to also receive the greenlit email, so that the whole community is informed — not just me.
19. As a **user with active tickets**, I want a link in the greenlit email to view my tickets and QR codes, so that I can access them before the event.
20. As an **organiser**, I want greenlit fan-out to happen automatically when the hype threshold is crossed, so that I do not have to manually notify attendees.

### Operations & development

21. As a **developer**, I want to run the backend locally without a Resend API key and see email previews in the console, so that I can develop without sending real mail.
22. As a **developer**, I want mock sends logged as `mock_sent` (not `sent`), so that audit data reflects reality.
23. As a **developer** on a shared staging environment, I want all emails redirected to a single override inbox, so that demo accounts (`user@smu.edu.sg`, etc.) are not emailed accidentally.
24. As a **developer**, I want failed Resend calls retried once before marking `failed`, so that transient network blips do not immediately lose delivery.
25. As a **developer**, I want each send attempt recorded in `notification_logs`, so that I can debug delivery issues without reading server logs alone.
26. As a **developer**, I want notification logging failures to never throw or block the API response, so that a broken log table does not break pledges.
27. As a **maintainer**, I want user-supplied strings (event titles, usernames) HTML-escaped in templates, so that malicious organiser input cannot break email layout or inject content.
28. As a **maintainer**, I want greenlit recipient lookup via a Postgres RPC, so that the backend does not need a service-role key or violate RLS on the `USER` table.

### Edge cases & correctness

29. As a **user**, I want only one pledge-confirmed email per successful pledge request, so that I am not spammed on retries.
30. As a **user**, I want a greenlit fan-out email only when the event status actually transitions to greenlit, so that I am not notified on pledges that do not cross the threshold.
31. As a **user who gave away all tickets**, I should not receive a greenlit email for that event (no active tickets), so that notifications reflect my current involvement.
32. As a **user**, I want emails sent from a configurable from-address, so that production mail comes from a verified domain.
33. As a **user** whose email is overridden in staging, I want the log to still record my real recipient address, so that staging tests remain traceable.

## Implementation Decisions

### Architecture

- **Email provider:** Resend, integrated in a dedicated email processor module with retry (2 attempts, 10s timeout, 2s delay) and mock-mode fallback when `RESEND_API_KEY` is missing or placeholder.
- **Orchestration:** A notification service module owns three fire-and-forget entry points: `notifyPledgeConfirmed`, `notifyTicketsGivenAway` (rename from current `notifyPledgeCancelled`), and `notifyEventGreenlit`.
- **Trigger location (v1):** Controllers for `POST /api/checkout/:eventId/pledge` and `POST /api/profile/bookings/:bookingId/give-away` invoke notification functions after a successful mutation. Greenlit fan-out is triggered when `eventBefore.status !== 'greenlit'` and `result.event.status === 'greenlit'`.
- **Decoupling:** Notification functions return immediately; async work runs in a detached promise. API responses are unchanged. See ADR-0001.
- **Future (v2):** Move triggers into `eventService` or a `notificationOrchestrator` when deadline jobs and organiser-cancellation paths are added.

### Schema

Add `notification_logs` table:

| Column | Type | Notes |
|---|---|---|
| `id` | bigint PK | identity |
| `user_id` | uuid nullable | FK → `USER.id` |
| `recipient_email` | text | intended recipient (not override address) |
| `event_id` | uuid nullable | FK → `EVENT.id` |
| `notification_type` | text enum | `pledge_confirmed`, `tickets_given_away`, `event_greenlit` |
| `subject` | text | |
| `status` | text enum | `sent`, `mock_sent`, `failed` |
| `error_message` | text nullable | |
| `sent_at` | timestamptz nullable | set when `sent` or `mock_sent` |
| `created_at` | timestamptz | default now() |

Add Postgres RPC `get_event_notification_recipients(p_event_id uuid)` returning `{ userId, email, username }[]` for users with at least one active ticket on the event (non-soft-deleted bookings, tickets not fully given away). `SECURITY DEFINER`; used only by the notification service's server-side Supabase client for greenlit fan-out.

Document both in `DBTABLES.md`.

### Environment variables

| Variable | Required | Purpose |
|---|---|---|
| `RESEND_API_KEY` | Production/staging with real sends | Resend API authentication |
| `NOTIFICATION_FROM_EMAIL` | Optional | Sender address; defaults to Resend onboarding address |
| `NOTIFICATION_OVERRIDE_EMAIL` | Required in shared staging | Redirect all recipients to team inbox |
| `SUPABASE_URL` | Yes | Already required by backend |
| `SUPABASE_ANON_KEY` | Yes | Server client for `notification_logs` insert and RPC calls |

### Email templates

Three HTML templates sharing a dark-theme shell matching party.fun branding:

- **Pledge confirmed:** payment captured now; total locked; refund-if-not-greenlit by deadline; no "charged on greenlight" language.
- **Tickets given away:** quantity released; explicit "no refund" copy; different headline/body for partial vs full give-away (same `notification_type`).
- **Event greenlit:** tickets pledged framing (e.g. "47 of 40 tickets pledged"); schedule and location; no "X backers" language.

All user-provided template variables (`username`, `eventTitle`, `location`, etc.) must pass through an HTML escape helper. Numeric and server-formatted date fields do not. Button URLs are hardcoded to the app origin, not user input.

### Email processor behaviour

```
sendEmail({ to, subject, html }) → { success, messageId?, error? }

if NOTIFICATION_OVERRIDE_EMAIL set → send to override, log original `to`
if RESEND_API_KEY invalid/missing → console mock preview, return success with mock messageId
else → Resend send with retry; return success or failure
```

Notification service maps processor outcome + mode to log status:

- Real Resend success → `sent`
- Mock mode success → `mock_sent`
- Exhausted retries → `failed`

### API contracts (unchanged)

Notifications are side effects; existing response shapes are preserved:

- `POST /api/checkout/:eventId/pledge` → `{ status: 'ok', event, profile }`
- `POST /api/profile/bookings/:bookingId/give-away` → `{ status: 'ok', event, profile }`

No new public API routes in v1.

### Known gaps in current prototype (to fix)

The experiment branch PR has partial implementation that diverges from agreed decisions:

- `notifyPledgeCancelled` naming and refund-themed copy → rename and rewrite for give-away semantics.
- Pledge template says payment on greenlight → rewrite for capture-at-pledge.
- Greenlit template says "backers" → rewrite for tickets pledged.
- Greenlit fan-out queries `BOOKINGS.activeTicketCount` (non-existent column) → replace with RPC.
- Mock mode logs `sent` instead of `mock_sent`.
- No HTML escaping in templates.
- `notification_logs` table not yet in Supabase schema.

## Testing Decisions

### What makes a good test

Test **observable behaviour at module boundaries**, not internal promise wiring or console output formatting. Prefer injecting or mocking the email processor and Supabase RPC at the highest seam that still proves the feature works end-to-end.

Do not assert on log message strings or Resend SDK call order. Do assert on: API response status, notification log records (when test DB available), template output content, and processor return values.

### Proposed test seams (highest first)

1. **HTTP integration (preferred):** Exercise `POST /api/checkout/:eventId/pledge` and `POST /api/profile/bookings/:bookingId/give-away` with a test Supabase fixture and a stubbed `sendEmail`. Assert `200` + `{ status: 'ok' }` and that the stub received correct `to`, `subject`, and key content fragments. Assert no notification call on `409`/`404` error paths.

2. **Template unit tests:** Render each template with fixture data including HTML-special characters in `eventTitle` / `username`. Assert escaped output and correct domain copy (capture-at-pledge, no refund on give-away, tickets-not-backers on greenlit).

3. **Email processor unit tests:** Mock Resend. Cases: missing key → mock mode; override redirects recipient; retry then success; retry exhausted → `{ success: false }`; valid key → `{ success: true, messageId }`.

4. **Notification service unit tests:** Stub `sendEmail` and Supabase insert/RPC. Assert `logNotification` receives correct `notification_type` and `status` mapping (`mock_sent` vs `sent` vs `failed`). Assert greenlit fan-out calls RPC and sends one email per recipient.

### Prior art

No automated tests exist in the backend today. This feature establishes the first test suite. Follow patterns from `.agents/skills/tdd` — mock external IO (Resend, Supabase) at boundaries; keep tests colocated under `backend/` (e.g. `backend/__tests__/` or `*.test.js` beside modules).

### Manual test plan

1. Local, no `RESEND_API_KEY`: pledge → console mock preview + `mock_sent` log.
2. Staging with override: pledge as `user@smu.edu.sg` → mail arrives at override inbox only.
3. Pledge that crosses hype threshold → greenlit fan-out to all active ticket holders.
4. Partial give-away (1 of 3) → email shows 1 ticket released, booking still upcoming.
5. Full give-away → email shows all tickets released; no refund language.
6. Event title with `<script>` → email shows escaped text, not executed markup.

## Out of Scope

- Deadline-failure automatic refunds and their notification emails
- Organiser-initiated event cancellation emails to ticket holders
- Soft-delete booking (`DELETE /api/profile/bookings/:id`) notifications
- In-app notification bell or unread state
- Message queue, outbox pattern, or guaranteed-delivery retry worker (v2)
- SMS or push notification channels
- Email open/click tracking
- User preference to opt out of transactional mail
- Organiser notifications (e.g. "your event greenlit")
- i18n / locale-specific template variants
- Moving notification triggers from controllers to `eventService` (v1 keeps controller hooks; v2 follow-up)

## Further Notes

- Domain glossary: see `CONTEXT.md` — use **give-away**, **pledge**, **greenlit**, **payment capture**, **active ticket count** consistently; avoid cancellation/refund/backers in give-away and greenlit contexts.
- Architectural record: `docs/adr/0001-transactional-email-notifications.md`.
- README should document new backend env vars (`RESEND_API_KEY`, `NOTIFICATION_FROM_EMAIL`, `NOTIFICATION_OVERRIDE_EMAIL`) and the three-environment routing policy.
- The footer line "transactional receipt for your crowdfunding pledge" is appropriate for pledge confirmed; give-away and greenlit templates may use context-specific footer copy.
- Greenlit `backers_count` in templates should display active ticket count vs hype threshold, not unique user count.
- `deleteBooking` (soft-delete from cancelled/past tab) intentionally sends no email in v1.
