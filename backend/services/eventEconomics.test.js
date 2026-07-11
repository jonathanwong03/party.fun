import test from 'node:test';
import assert from 'node:assert/strict';

import { computeEconomics, defaultCalculatorState, hypeRevenue } from './eventEconomics.js';

test('tiered economics sum price x qty per tier and subtract costs', () => {
  const state = {
    tickets: { model: 'tiered', tiers: [
      { key: 'early_bird', label: 'Early bird', price: 12, qty: 50 },
      { key: 'greenlit', label: 'Greenlit', price: 18, qty: 40 },
    ] },
    costs: [{ name: 'Venue', amount: 200 }, { name: 'Food', amount: 100 }],
  };
  const e = computeEconomics(state);
  assert.equal(e.totalRevenue, 12 * 50 + 18 * 40); // 1320
  assert.equal(e.ticketCount, 90);
  assert.equal(e.totalCost, 300);
  assert.equal(e.profit, 1020);
});

test('hype revenue rises along the bonding curve and never exceeds max*qty', () => {
  const rev = hypeRevenue(20, 50, 100, 10);
  assert.ok(rev > 20 * 10); // above buying all at base
  assert.ok(rev < 50 * 10); // below buying all at max
});

test('hype economics use the curve and are defensive on bad input', () => {
  const e = computeEconomics({ tickets: { model: 'hype', basePrice: 20, maxPrice: 50, capacity: 100, qty: 10 }, costs: [] });
  assert.equal(e.ticketCount, 10);
  assert.ok(e.totalRevenue > 0);
  assert.equal(computeEconomics({ tickets: { model: 'hype', basePrice: 0, maxPrice: 0, capacity: 0, qty: 0 } }).totalRevenue, 0);
});

test('defaultCalculatorState prefills from the event pricing model', () => {
  const tiered = defaultCalculatorState({
    hypeDrivenPricing: false,
    statuses: [
      { statusName: 'early_bird', price: 10, ticketCapacity: 30 },
      { statusName: 'greenlit', price: 15, ticketCapacity: 30 },
    ],
  });
  assert.equal(tiered.tickets.model, 'tiered');
  assert.equal(tiered.tickets.tiers[0].price, 10);
  assert.equal(tiered.tickets.tiers[0].qty, 30);
  assert.ok(tiered.costs.length > 0);

  const hype = defaultCalculatorState({ hypeDrivenPricing: true, basePrice: 20, maxPrice: 60, maxCapacity: 80 });
  assert.equal(hype.tickets.model, 'hype');
  assert.equal(hype.tickets.capacity, 80);
  assert.equal(hype.tickets.qty, 80);
});
