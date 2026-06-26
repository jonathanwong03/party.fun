import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  ticketPrice,
  quoteTotal,
  validateHypePricingConfig,
} from './pricingCalculator.js';

const config = { basePrice: 10, maxPrice: 100, maxCapacity: 100 };

describe('ticketPrice', () => {
  it('returns base price when active ticket count is zero', () => {
    assert.equal(ticketPrice(0, config), 10);
  });

  it('returns max price when active ticket count equals capacity', () => {
    assert.equal(ticketPrice(100, config), 100);
  });

  it('clamps active count above capacity to max price', () => {
    assert.equal(ticketPrice(150, config), 100);
  });

  it('follows the exponential bonding curve at the midpoint', () => {
    const mid = ticketPrice(50, config);
    assert.ok(Math.abs(mid - 31.622776601683793) < 1e-9);
  });
});

describe('quoteTotal', () => {
  it('equals a single ticket price when quantity is one', () => {
    const quote = quoteTotal(25, 1, config);
    assert.equal(quote.quantity, 1);
    assert.equal(quote.unitPrices.length, 1);
    assert.equal(quote.unitPrices[0], ticketPrice(25, config));
    assert.equal(quote.total, quote.unitPrices[0]);
  });

  it('sums bonding curve prices for each ticket in a bulk quote', () => {
    const quote = quoteTotal(0, 2, config);
    const expected = ticketPrice(0, config) + ticketPrice(1, config);
    assert.equal(quote.quantity, 2);
    assert.equal(quote.unitPrices[0], ticketPrice(0, config));
    assert.equal(quote.unitPrices[1], ticketPrice(1, config));
    assert.ok(Math.abs(quote.total - expected) < 1e-9);
  });

  it('rejects quotes that would exceed event capacity', () => {
    assert.throws(
      () => quoteTotal(99, 2, config),
      /exceeds maxCapacity/,
    );
  });
});

describe('validateHypePricingConfig', () => {
  it('accepts valid hype-driven pricing configuration', () => {
    assert.deepEqual(validateHypePricingConfig(config), { ok: true });
  });

  it('rejects base price greater than or equal to max price', () => {
    assert.deepEqual(
      validateHypePricingConfig({ basePrice: 100, maxPrice: 100, maxCapacity: 50 }),
      { error: 'base_price_must_be_less_than_max' },
    );
    assert.deepEqual(
      validateHypePricingConfig({ basePrice: 120, maxPrice: 100, maxCapacity: 50 }),
      { error: 'base_price_must_be_less_than_max' },
    );
  });

  it('rejects non-positive prices or capacity', () => {
    assert.deepEqual(
      validateHypePricingConfig({ basePrice: 0, maxPrice: 100, maxCapacity: 50 }),
      { error: 'prices_must_be_positive' },
    );
    assert.deepEqual(
      validateHypePricingConfig({ basePrice: 10, maxPrice: 100, maxCapacity: 0 }),
      { error: 'max_capacity_must_be_positive' },
    );
  });
});
