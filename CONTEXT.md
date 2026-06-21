# party.fun

A campus-event crowdfunding and ticketing platform where users pledge for tickets and events greenlight once active ticket count reaches the hype threshold.

## Language

**Pledge**:
A user's commitment to buy tickets for an event, recorded as a booking. Payment is captured at pledge time.
_Avoid_: Purchase, checkout, order, reservation (implies unpaid hold)

**Payment capture**:
Money is taken from the user at the moment they pledge. If the event fails to greenlight by the deadline, captured funds are refunded.
_Avoid_: Charge on greenlight, authorization hold, pay later

**Booking**:
The persisted record of a pledge — one payment transaction per user per event (`BOOKINGS` row).
_Avoid_: Pledge (when referring to the database entity), transaction

**Ticket**:
An individual seat within a booking, with its own lifecycle (`active`, `given_away`, `refunded`, `used`).
_Avoid_: Spot, seat allocation

**Give-away**:
A voluntary release of some or all active tickets back to the event pool. No money is returned.
_Avoid_: Cancellation, refund, release

**Cancellation**:
When an event fails to reach its hype threshold by the deadline, or when an organiser cancels the event. Active tickets are refunded.
_Avoid_: Give-away, delete

**Refund**:
Money returned to a user when tickets are cancelled at the event level (deadline miss or organiser cancellation). Not applicable to give-aways.
_Avoid_: Cancelled amount, reversed payment

**Greenlit**:
An event that has reached its hype threshold (`activeTicketCount ≥ hypeThreshold`). The event is confirmed and tickets are locked in. Greenlighting is measured in tickets pledged, not unique backers — one user pledging 5 tickets counts as 5 toward the threshold.
_Avoid_: Confirmed, funded, successful, backer count

**Active ticket count**:
The number of tickets currently pledged and not given away or refunded across all users for an event. Drives hype percentage and greenlighting.
_Avoid_: Backers, backers count, ticket sales

**Hype threshold**:
The minimum active ticket count required for an event to greenlight.
_Avoid_: Funding goal, target backers, minimum backers

**Notification recipient**:
A user who should receive a transactional email about an event they are involved in (pledged, gave away tickets, or was affected by greenlight/cancellation).
_Avoid_: Subscriber, mailing list member

**Greenlit notification**:
An email sent to every user with at least one active ticket on an event when that event transitions to greenlit. Recipient emails are resolved server-side via a Postgres RPC, not by querying other users' profile rows through RLS.
_Avoid_: Broadcast, newsletter, blast

**Notification log**:
A durable record of each email send attempt (`notification_logs`), capturing recipient, event, type, and outcome. Used for audit and debugging, not for retry orchestration in v1.
_Avoid_: Message queue, outbox, delivery receipt

**Notification delivery status**:
The outcome of a send attempt. `sent` means Resend accepted the message; `mock_sent` means dev/mock mode (console only, no real delivery); `failed` means all retries were exhausted.
_Avoid_: Delivered, read, opened

## Notifications (v1 scope)

**Pledge confirmed notification**:
Sent immediately after a successful pledge. Confirms payment capture and states the refund-if-not-greenlit condition.
_Avoid_: Receipt, order confirmation

**Tickets given away notification**:
Sent when a user gives away one or more active tickets. Confirms how many tickets were released and that no refund was issued. Partial and full give-aways use the same notification type with quantity-dependent copy.
_Avoid_: Pledge cancelled, cancellation notice, refund confirmation

**Greenlit notification (fan-out)**:
Sent to all active ticket holders when an event transitions to greenlit. Triggered by the pledge that crosses the threshold.
_Avoid_: Event confirmed blast, success newsletter

_Out of v1 scope_: deadline-failure refunds, organiser-initiated event cancellation, soft-delete from profile.

**Transactional notification**:
An email triggered by a domain event (pledge, give-away, greenlit). Delivery is a side effect — the underlying action succeeds even if the email fails.
_Avoid_: Confirmation requirement, two-phase commit, delivery guarantee
