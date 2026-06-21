# Issue 01: Dynamic pricing schema extension and math client module

**Status:** implemented

## Parent

`.scratch/hype-driven-pricing/PRD.md`

## What to build

Extend the database table schemas to support dynamic pricing event configurations and build a mathematical helper module implementing the exponential bonding curve formula and its summation logic for calculating bulk quotes.

## Acceptance criteria

- [ ] `EVENT_SETTINGS` table has columns `hype_driven_pricing` (boolean, default false), `base_price` (numeric, nullable), and `max_price` (numeric, nullable) to support dynamic configuration.
- [ ] Added validation constraint to reject configurations where `base_price >= max_price`.
- [ ] Create a math helper module in `backend/utils/pricingCalculator.js` that implements:
  - The bonding curve price function: $P(x) = P_{base} \cdot (P_{max}/P_{base})^{x/C}$
  - Summation function: $\sum_{k=0}^{Q-1} P(x + k)$ to support multi-ticket quotes.
- [ ] Unit tests covering the bonding curve mathematical precision, boundary cases (e.g. $x=0$, $x=C$, $Q=1$, $Q>1$), and validation parameters.

## Blocked by

None - can start immediately
