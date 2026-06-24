# Issue 03: End-to-end Pledged Transaction with Dynamic Price Capture

**Status:** ready-for-agent

## Parent

`.scratch/hype-driven-pricing/PRD.md`

## What to build

Update the backend checkout booking controller and Postgres `create_pledge` stored procedure to retrieve the live active ticket count, compute the dynamic quote total, assert sufficient balances/charge cards for the correct sum, write custom ticket price items, and finalize the pledge transaction.

## Acceptance criteria

- [ ] Postgres `create_pledge` function is updated to support dynamic pricing: calculates total dynamic price for quantity $Q$ at current active count, and checks wallet balances / processes card charges against this exact dynamically computed total.
- [ ] Inserts individual record items in `BOOKING_ITEMS` using the correct mathematical curve prices for each ticket.
- [ ] Updates `BOOKINGS.amountPaid` with the exact sum of dynamic prices.
- [ ] Pledge confirmed notification hooks resolve successfully and log original values.
- [ ] Integration tests covering successful checkout transaction handling with mock client validations.

## Blocked by

- `.scratch/hype-driven-pricing/issues/02-dynamic-quote-calculator.md`
