# Issue 04: Pricing elasticity on ticket giveaway flows and UI detail maps

**Status:** ready-for-agent

## Parent

`.scratch/hype-driven-pricing/PRD.md`

## What to build

Verify that ticket giveaway actions dynamically shift the pricing curve back down as tickets are released. Expose dynamic pricing indicators, current ticket pricing estimation, base price, and max price parameters to the event dashboard details inside the React frontend client.

## Acceptance criteria

- [ ] Ticket giveaway function (`give_away_tickets`) successfully decreases `active_ticket_count`, leading to a lower subsequent price on the bonding curve.
- [ ] Expose dynamic pricing attributes (`hype_driven_pricing`, `base_price`, `max_price`, and current dynamic price) via backend event listing API contracts.
- [ ] Frontend event detail views show the estimated cost for a new pledge using the live price.
- [ ] Frontend dashboard displays base and max price parameters under the event settings card.
- [ ] Manual test case verification that giving away tickets drops the price for subsequent buyers.

## Blocked by

- `.scratch/hype-driven-pricing/issues/03-pledged-transaction-capture.md`
