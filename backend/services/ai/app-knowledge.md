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

## Other
- **University gating:** some events are restricted to a university; users only see events they're eligible to join.
- **Co-organisers:** an organiser can invite co-organisers to help manage an event.
- **Analytics:** organisers see projected ticket sales/revenue, itemised estimated operational costs (these are paid outside party.fun), and past-event totals.
