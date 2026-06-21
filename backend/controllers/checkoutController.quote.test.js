import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { getQuote, dependencies } from './checkoutController.js';

describe('getQuote', () => {
  const original = { ...dependencies };

  beforeEach(() => {
    Object.assign(dependencies, original);
  });

  it('returns a hype-driven quote from the checkout route', async () => {
    dependencies.quotePledge = async () => ({
      eventId: 'event-1',
      qty: 2,
      pricingModel: 'hype_driven',
      lines: [
        { label: 'Ticket 1', price: 10, count: 1, subtotal: 10, subtotalText: '$10.00' },
        { label: 'Ticket 2', price: 10.23, count: 1, subtotal: 10.23, subtotalText: '$10.23' },
      ],
      subtotal: 20.23,
      total: 20.23,
      subtotalText: '$20.23',
      totalText: '$20.23',
    });

    const res = createMockRes();
    await getQuote(
      {
        supabase: {},
        params: { eventId: 'event-1' },
        query: { qty: '2' },
        originalUrl: '/api/checkout/event-1/quote?qty=2',
      },
      res,
    );

    assert.equal(res.statusCode, 200);
    assert.equal(res.body.pricingModel, 'hype_driven');
    assert.equal(res.body.qty, 2);
    assert.equal(res.body.lines.length, 2);
    assert.equal(res.body.total, 20.23);
  });
});

function createMockRes() {
  return {
    statusCode: 200,
    body: null,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(payload) {
      this.body = payload;
      return this;
    },
  };
}
