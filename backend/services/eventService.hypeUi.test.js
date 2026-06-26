import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mapEventRow } from './eventService.js';
import { ticketPrice } from '../utils/pricingCalculator.js';

const hypeRow = {
  id: 'evt-1',
  hostId: 'host-1',
  title: 'Curve Night',
  organiser_name: 'DJ Hype',
  active_ticket_count: 25,
  hypeThreshold: 50,
  maxCapacity: 100,
  hypeDrivenPricing: true,
  basePrice: 10,
  maxPrice: 100,
  current_dynamic_price: 15.62,
  derived_status: 'early_bird',
  statuses: [
    { statusName: 'early_bird', price: 10, ticketCapacity: 50, sold: 25 },
    { statusName: 'greenlit', price: 20, ticketCapacity: 50, sold: 0 },
  ],
};

describe('mapEventRow hype-driven pricing', () => {
  it('exposes dynamic pricing fields on the event listing contract', () => {
    const event = mapEventRow(hypeRow, null);

    assert.equal(event.hypeDrivenPricing, true);
    assert.equal(event.basePrice, 10);
    assert.equal(event.maxPrice, 100);
    assert.equal(event.currentDynamicPrice, 15.62);
    assert.equal(event.hype_driven_pricing, true);
    assert.equal(event.base_price, 10);
    assert.equal(event.max_price, 100);
    assert.equal(event.current_dynamic_price, 15.62);
    assert.equal(event.price, 15.62);
  });

  it('computes currentDynamicPrice from active count when RPC omits it', () => {
    const { current_dynamic_price: _drop, ...row } = hypeRow;
    const event = mapEventRow(row, null);
    const expected = Math.round(ticketPrice(25, { basePrice: 10, maxPrice: 100, maxCapacity: 100 }) * 100) / 100;

    assert.equal(event.currentDynamicPrice, expected);
    assert.equal(event.price, expected);
  });

  it('uses static tier price when hype-driven pricing is disabled', () => {
    const event = mapEventRow({ ...hypeRow, hypeDrivenPricing: false, current_dynamic_price: null }, null);

    assert.equal(event.hypeDrivenPricing, false);
    assert.equal(event.currentDynamicPrice, null);
    assert.equal(event.price, 10);
  });
});

describe('give-away pricing elasticity', () => {
  it('lowers the live ticket price when active ticket count drops', () => {
    const config = { basePrice: 10, maxPrice: 100, maxCapacity: 100 };
    const before = ticketPrice(25, config);
    const after = ticketPrice(24, config);

    assert.ok(after < before);
    const { current_dynamic_price: _drop, ...rowBefore } = hypeRow;
    assert.equal(
      mapEventRow({ ...rowBefore, active_ticket_count: 25 }, null).price,
      Math.round(before * 100) / 100,
    );
    assert.equal(
      mapEventRow({ ...rowBefore, active_ticket_count: 24 }, null).price,
      Math.round(after * 100) / 100,
    );
  });
});
