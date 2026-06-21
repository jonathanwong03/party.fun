# Issue 02: Tickets given away email

**Status:** ready-for-agent

## Parent

`.scratch/transactional-email-notifications/PRD.md`

## What to build

After a successful give-away (`POST /api/profile/bookings/:bookingId/give-away`), send a **tickets given away** transactional email to the user who released tickets. The email confirms how many tickets were given away and explicitly states that **no refund** was issued.

Use correct domain language throughout: **give-away**, not cancellation or refund. Partial give-aways (e.g. 1 of 3 tickets) and full give-aways use the same `notification_type` (`tickets_given_away`) with quantity-dependent copy.

Rename the existing `notifyPledgeCancelled` to `notifyTicketsGivenAway` and remove refund-themed template content from the current implementation.

## Acceptance criteria

- [ ] `notifyTicketsGivenAway` replaces `notifyPledgeCancelled` in the notification service and give-away controller
- [ ] `notification_type` is `tickets_given_away` in `notification_logs`
- [ ] Email subject and body avoid "cancelled", "refund", and "cancelled amount" language
- [ ] Partial give-away copy states the specific quantity released (e.g. "You gave away 1 ticket")
- [ ] Full give-away copy states all tickets were released back to the pool
- [ ] Email explicitly notes no refund was issued for a voluntary give-away
- [ ] User-supplied strings remain HTML-escaped
- [ ] Give-away API returns `{ status: 'ok' }` even if email delivery fails
- [ ] No email sent on give-away error paths (`404`, `400`)
- [ ] Unit tests: give-away template (partial vs full copy, no refund language, HTML escaping)
- [ ] HTTP integration test: successful give-away triggers stubbed `sendEmail` with correct subject fragment
- [ ] Manual: partial give-away (1 of 3) and full give-away both produce correct emails in mock mode

## Blocked by

- Issue 01 (`01-pledge-confirmed-email.md`)
