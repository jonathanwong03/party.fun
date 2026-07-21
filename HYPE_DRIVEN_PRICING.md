# Hype-Driven Pricing

**Status:** implemented  
**Feature slug:** hype-driven-pricing  
**Related docs:** [APP_OVERVIEW.md](APP_OVERVIEW.md#hype-driven-pricing) (as-built behaviour, database columns and lock rules)

---

## Problem Statement

Our dynamic pricing curve increases ticket prices automatically as more people buy. But during a review, the project mentor pushed back with a very practical objection: **it is totally unrealistic to charge $70 to $100+ for a standard ticket like a movie.** They felt that letting ticket prices skyrocket like that makes the app unusable for normal everyday events.

## Solution

To address this objection, we realize that the problem isn't the algorithm itself—it's how the event host sets it up. 

Instead of forcing a one-size-fits-all pricing range, we give event hosts full control over the floor and ceiling. If you are hosting a simple movie night, you can set the ticket to start at $10 and cap out at a maximum of $15. The algorithm will smoothly scale between those two points, keeping it completely realistic. On the other hand, if you are hosting a highly exclusive VIP party with limited spots, you can choose to set a wider range (like $30 to $120). 

By letting the host define the price boundaries to match their event type, we completely solve the mentor's concern while still keeping the benefits of dynamic pricing (rewarding early birds who buy when the event is unconfirmed, and preventing scalpers from bulk-buying cheap slots).

### How the Formula Works (Clamped Scaling Slider)

The ticket price $P$ for a new ticket is defined by:
$$P(x) = P_{\text{base}} \cdot \left( \frac{P_{\text{max}}}{P_{\text{base}}} \right)^{\frac{x}{C}}$$
where:
- $x$ is the current live **Active Ticket Count**.
- $C$ is the event capacity (`maxCapacity`).
- $P_{\text{base}}$ is the **Base Ticket Price** (starting price when $x = 0$).
- $P_{\text{max}}$ is the **Max Ticket Price** (peak price when $x = C$).

Because the fraction $\frac{x}{C}$ is always between $0$ (at the start) and $1$ (at full capacity), the formula functions as a **scaling slider** bounded by the host's limits:
- **At the start ($x = 0$):** The price is exactly $P_{\text{base}}$.
- **At full capacity ($x = C$):** The price is exactly $P_{\text{max}}$.

This ensures the price **never exceeds the host's maximum cap**, turning sudden cliff-like price jumps (e.g. going from a $10 Early Bird to a $20 Standard ticket instantly) into a smooth, predictable ramp.

Pricing is fully elastic: if tickets are given away, $x$ drops and subsequent ticket prices go down symmetrically.
Refunds/payout calculations (e.g. for event cancellations) must support the exact historical amount paid per booking (tracked in `BOOKINGS.amountPaid`) rather than assuming a fixed single unit price.


## User Stories

### Event Setup
1. As an **organiser**, I want to configure my event to use **Hype-Driven Pricing**, so that ticket pricing scales dynamically.
2. As an **organiser**, I want to define a **Base Ticket Price ($P_{base}$)** and a **Max Ticket Price ($P_{max}$)** when creating or editing an event, so that the curve boundaries match my financial projections.
3. As an **organiser**, I want the platform to reject event configuration if $P_{base} \geq P_{max}$, so that the pricing curve is guaranteed to rise.

### Pledge & Checkout
4. As a **user**, I want to see the dynamic price of a ticket before I pledge, so that I am fully aware of the cost.
5. As a **user**, I want my quote (`GET /api/checkout/:eventId/quote?qty=N`) to integrate the integral (or summation) of the bonding curve for the requested quantities, so that I pay the mathematically correct price for multiple tickets.
6. As a **user**, I want my pledge to lock in the quote price I saw, so that my transaction amount does not unexpectedly change if someone else pledges at the same time.
7. As a **user**, I want my booking history to reflect the exact total amount paid for my tickets (`amountPaid`), so that I can audit my transaction history.

### Give-away & Elasticity
8. As a **user**, I want ticket prices to decrease if other users give away tickets (reducing the active ticket count), so that I can benefit from decreased demand.
9. As a **user**, I want the price of my already-purchased booking to be unaffected by subsequent active ticket count changes, so that my transaction remains final and immutable.

## Implementation Decisions

### Schema Changes
- Modify the `EVENT_SETTINGS` or `PRICE_STATUSES` to store flags/configurations indicating whether `hype_driven_pricing` is enabled.
- Alternatively, if `hype_driven_pricing` is enabled, we store $P_{base}$ and $P_{max}$ on `EVENT_SETTINGS`.
- When dynamic pricing is active, `PRICE_STATUSES` (which traditionally defines fixed price points) is bypassed for quote calculations in favor of the bonding curve formula.

### API Contracts & Formulas
- **Dynamic Quote Calculation**: The total price for a new pledge of quantity $Q$ starting at current active count $x$ is:
  $$\text{Total} = \sum_{k=0}^{Q-1} P(x + k)$$
  where each individual ticket $k$ scales the count $x$ by 1.
- **Pledge Mutation (`create_pledge` Postgres RPC)**:
  - Read current active ticket count.
  - Calculate summation of prices for $Q$ tickets.
  - Assert wallet balance or charge card for calculated total.
  - Record unit price per item line in `BOOKING_ITEMS` based on their actual curve values.
  - Update `amountPaid` on `BOOKINGS`.

## Testing Decisions

- A good test targets the external contract: quoting different quantities ($Q$) at various active ticket counts ($x$) must return exact values matching the exponential formula.
- Tests will target the database `get_quote` and `create_pledge` Postgres RPC functions, as well as the Express `/api/checkout/:eventId/quote` and `/api/checkout/:eventId/pledge` handlers.
- Existing controller tests (`backend/controllers/checkoutController.test.js`) will serve as prior art.

## Out of Scope
- Support for multiple/competing dynamic pricing models (e.g. linear, sigmoid) in v1.
- Re-pricing existing bookings retroactively.
- Refunding difference to users if prices drop (payouts remain final; price drops only affect new pledges).
