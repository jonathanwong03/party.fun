# PRD: Hype-Driven Pricing

**Status:** ready-for-agent  
**Feature slug:** hype-driven-pricing  
**Branch context:** `experiment`  
**Related docs:** `CONTEXT.md`, `DBTABLES.md`

---

## Problem Statement

Currently, event ticket prices are fixed on a static tier system (`early_bird` and `greenlit`) set by the organiser during creation. This does not align with the modern crowdfunding spirit of rewarding early adopters or dynamically responding to event popularity (FOMO). To solve this, organisers need a way to enable a mathematical pricing curve where the price starts at a base rate and rises continuously as more active tickets are pledged. Furthermore, users require price elasticity so that if tickets are voluntarily given away, the price dynamically drops back down.

## Solution

Implement **Hype-Driven Pricing** using an exponential **Bonding Curve** to dynamically scale ticket pricing.
The ticket price $P$ for a new ticket is defined by:
$$P(x) = P_{base} \cdot \left( \frac{P_{max}}{P_{base}} \right)^{\frac{x}{C}}$$
where:
- $x$ is the current live **Active Ticket Count**.
- $C$ is the event capacity (`maxCapacity`).
- $P_{base}$ is the **Base Ticket Price** (starting price when $x = 0$).
- $P_{max}$ is the **Max Ticket Price** (peak price when $x = C$).

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
