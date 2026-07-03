# party.fun — how the app works (assistant knowledge base)

party.fun is a campus events platform where organisers create events and students pledge for tickets. Tickets are only charged/confirmed once an event reaches its hype threshold ("greenlit").

## Payments: in-app wallet vs Stripe
- **Stripe (card):** Pledges paid by card are authorised/charged through Stripe. Refunds for card payments go back to the original card via Stripe.
- **In-app wallet:** Each user has a wallet balance. Pledges can be paid from the wallet, and refunds (e.g. when an event is cancelled or misses its threshold) are returned instantly to the wallet. Organiser payouts for completed events are credited to the organiser's wallet.
- Pledges are idempotent (a client attempt id + Stripe idempotency keys prevent double-charging).

## Event lifecycle (status)
- **early_bird** → event is live and collecting pledges before the deadline.
- **greenlit** → the event reached its hype threshold; tickets are confirmed. Once its end time passes it is paid out and becomes **completed**.
- **completed** → the event finished; ticket revenue (net of refunds) was paid out to the organiser's wallet.
- **cancelled** → cancelled by the organiser, or auto-cancelled because it missed its hype threshold by the deadline. All pledges are refunded in full.

## Hype-driven & tiered pricing
- Organisers can choose **tiered pricing** (early-bird price until the early allocation sells out, then a greenlit price) or a **hype curve** (each ticket's price rises from a base price toward a max price as more tickets sell).
- The hype threshold is the number of confirmed tickets needed to greenlight the event.

## Refunds
- Cancelled or missed-threshold events refund every backer in full (card → card, wallet → wallet) and notify them by email.
- Refunds are subject to a 180-day refund-window guard.

## Giving away tickets
- A backer can give away tickets they bought. Give-aways are final and non-refundable; the money they paid still counts as spend. Released spots return to the public pool.

## Deadlines & automation
- A scheduler periodically auto-cancels overdue early_bird events below threshold (refunding backers) and pays out greenlit events whose end time has passed. When an event completes, the organiser is emailed a revenue summary.

## App structure — where events live
- **All Events (discovery):** the public browse page. It shows events a user can **buy/pledge for** — i.e. events they do **not** host, that are still open (`early_bird` or `greenlit`, not `cancelled`/`completed`). To answer "the cheapest / most expensive ticket I can buy", scan **only** this list **and exclude events the user has already purchased** (they already hold a booking). Use the `list_available_events` tool — it already applies these filters and returns each event's current buyable price.
- **Hosted Events (organisers only):** an organiser's **own** events dashboard — the events they created (plus ones they co-organise). Shows each event's status (`early_bird`/`greenlit`/`completed`/`cancelled`), its early-bird and greenlit prices, tickets sold, and hype threshold. Use `get_my_hosted_events`.
- **Joined events:** events the user has pledged for (holds tickets in). Use `get_my_joined_events`.
- A user can be **both** an attendee (joins/buys events) and an organiser (hosts their own). "My events" is ambiguous — clarify whether they mean events they **host** vs events they **joined**.

## Ticket prices
- **Tiered events:** each tier has a fixed price — `early_bird` first, then `greenlit`. The "price of a ticket" is the tier currently on sale.
- **Hype-driven events:** the live price rises with the active ticket count (base → max); the *current* price is what a buyer pays now.

## Editing, creating & deleting events (organisers)
- An organiser can edit their own **open** event's title, description, venue/address, dates, deadline, capacity, hype threshold, and prices (the pricing **model** is locked after creation). Editing notifies backers.
- New events can be started as **drafts** and published from the Drafts tab.
- **"Deleting" an event depends on its state:** a **published** event is **cancelled** (which closes it and refunds every backer) — use `propose_cancel_event`. An unpublished **draft** is deleted outright — use `propose_delete_draft`. There is no way to hard-delete a published event without refunding its backers.

## Agent tools & how the assistant acts
The assistant is a LangGraph workflow: a `classify` step tags each request (read-only question · event discovery · cheapest/best-fit · event management · transaction) and routes it to one of five branch **agents** (each a canonical `createAgent` with a scoped toolset), which call server-side tools. **Read** tools: `search_events`, `list_available_events`, `get_event_details`, `get_event_forecast`, `get_my_hosted_events`, `get_my_joined_events`, `get_wallet`, `list_my_drafts`. **Write** tools only ever create a **proposal the user must confirm** — in ask-mode the graph pauses at a human-in-the-loop step (nothing happens until they click Confirm / say "confirm"; Dismiss rejects it), then executes with a fresh server-side re-validation of ownership and balances:
- Events: `propose_update_event`, `propose_create_event` (drafts a new event — needs a title + start/end/deadline), `propose_invite_coorganiser`, `propose_cancel_event` (cancel + refund), `propose_delete_draft`.
- Money (all real transactions): `propose_topup` (charge the linked card to add wallet money), `propose_pledge` (buy ticket(s) with the wallet balance — a deduction), and refunds via `propose_cancel_event`.
The agent never claims a change or a payment is done until the user confirms it. It also has a `remember` tool to save durable preferences and personalise future help.

The assistant always knows the **current user's role** (organiser / user / admin), injected into its context each turn. `get_my_hosted_events` and `get_event_details` report each event's **live status** (early_bird/greenlit/completed/cancelled), the **current price** a buyer pays now (status- and hype-aware), and — for the organiser's own events — the **net revenue so far**. Replies are written in plain text (no markdown), as short paragraphs separated by blank lines.

## Other
- **University gating:** some events are restricted to a university; users only see events they're eligible to join.
- **Co-organisers:** an organiser can invite co-organisers to help manage an event.
- **Analytics:** organisers see projected ticket sales/revenue, itemised estimated operational costs (these are paid outside party.fun), and past-event totals.
