# Issue 02: Dynamic Quote Calculator API endpoint

**Status:** implemented

## Parent

`.scratch/hype-driven-pricing/PRD.md`

## What to build

Update the public get-quote checkout logic to integrate the bonding curve calculator. When an event has dynamic pricing enabled, bypass static pricing status rules and calculate the quote dynamically using the summation of the bonding curve values starting at the live active ticket count.

## Acceptance criteria

- [ ] `GET /api/checkout/:eventId/quote?qty=N` returns a dynamically calculated quote using `pricingCalculator` when `hype_driven_pricing` is true.
- [ ] Summation calculations are based on the current live `active_ticket_count` retrieved from the database.
- [ ] The JSON response payload matches the legacy shape (subtotals, total, unit lines) but maps calculated increments.
- [ ] Integration tests covering the `/api/checkout/:eventId/quote` route response validation under dynamic pricing.

## Blocked by

- `.scratch/hype-driven-pricing/issues/01-dynamic-pricing-schema.md`
