# Issue 03: Greenlit fan-out email

**Status:** ready-for-agent

## Parent

`.scratch/transactional-email-notifications/PRD.md`

## What to build

When a pledge causes an event to transition to **greenlit** (`eventBefore.status !== 'greenlit'` and `result.event.status === 'greenlit'`), fan out a greenlit email to every user with at least one **active ticket** on that event.

Recipient lookup must use a `SECURITY DEFINER` Postgres RPC (`get_event_notification_recipients`) returning `{ userId, email, username }[]` — not a direct query on `BOOKINGS.activeTicketCount` (which is a derived field, not a column). This preserves the JWT-only backend model (see ADR-0001).

Greenlit email copy references **tickets pledged** vs hype threshold, not "backers" or unique users. Includes event schedule and location.

## Acceptance criteria

- [ ] `get_event_notification_recipients(p_event_id uuid)` RPC exists in Supabase and is documented in `DBTABLES.md`
- [ ] RPC returns only users with active tickets on the event (non-soft-deleted bookings, not fully given away)
- [ ] `notifyEventGreenlit` uses the RPC for recipient lookup; broken `BOOKINGS.activeTicketCount` query is removed
- [ ] Greenlit fan-out fires only on actual `early_bird → greenlit` transition, not on every pledge
- [ ] Users who gave away all tickets are excluded from fan-out
- [ ] One email per recipient; greenlit template uses tickets-pledged framing (e.g. "47 of 40 tickets pledged")
- [ ] Template avoids "backers" / "X backers" language
- [ ] User-supplied strings HTML-escaped; schedule/location rendered correctly
- [ ] Each fan-out send logged individually in `notification_logs` as `event_greenlit`
- [ ] Pledge API still returns `{ status: 'ok' }` if fan-out fails
- [ ] Unit tests: greenlit template (tickets-not-backers copy, HTML escaping)
- [ ] Unit tests: `notifyEventGreenlit` calls RPC and sends one stubbed email per recipient
- [ ] Manual: pledge that crosses hype threshold triggers fan-out to all active ticket holders in mock mode

## Blocked by

- Issue 01 (`01-pledge-confirmed-email.md`)
