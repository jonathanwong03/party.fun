# party.fun

A campus-event crowdfunding and ticketing platform where users pledge for tickets and events greenlight once active ticket count reaches the hype threshold.

## App structure (pages & events)

**All Events (discovery)**:
The public browse page listing events a user can **pledge for** — events they do **not** host that are still open (`early_bird` or `greenlit`; not `cancelled`/`completed`). "The cheapest / most expensive ticket I can buy" is computed over **this** list, **excluding** events the user has already purchased (already holds a booking).

**Hosted Events (organiser dashboard)**:
An organiser's **own** events (created + co-organised), each with its status, early-bird & greenlit prices, tickets sold, and hype threshold. Distinct from All Events, which is what everyone browses to buy.

**Joined events**:
Events the user has pledged for (holds active tickets in).

**Event status**:
`early_bird` (open, collecting pledges) → `greenlit` (hit its hype threshold; confirmed) → `completed` (finished, paid out); or `cancelled` (organiser cancelled, or missed threshold by deadline — all pledges refunded).

**Draft event**:
An unpublished event saved in the organiser's Drafts tab, resumed and published later via the Create Event form. The AI assistant creates new events as drafts.

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

## Hype-Driven Pricing

**Hype-Driven Pricing**:
A pricing model where the price of a ticket dynamically increases as the **Active Ticket Count** approaches or exceeds the **Hype Threshold**.
_Avoid_: Surge pricing, dynamic ticket cost, custom tier pricing

**Bonding Curve**:
The mathematical formula that defines the relationship between the **Active Ticket Count** ($x$) and the dynamic price of a ticket ($P$):
$$P(x) = P_{base} \cdot \left( \frac{P_{max}}{P_{base}} \right)^{\frac{x}{C}}$$
where $P_{base}$ is the Base Ticket Price, $P_{max}$ is the Max Ticket Price, and $C$ is the event's `maxCapacity`.
_Avoid_: Pricing algorithm, dynamic formula

**Base Ticket Price ($P_{base}$)**:
The starting price of the first ticket pledged when the active ticket count is zero.
_Avoid_: Early bird price, starting price, initial cost

**Max Ticket Price ($P_{max}$)**:
The theoretical price of a ticket when the event is at full capacity.
_Avoid_: Greenlit price, cap price, peak price

**Price Elasticity**:
The property where the ticket price fluctuates symmetrically (both up and down) with the current live **Active Ticket Count**.
_Avoid_: Reversible price, pricing drops

