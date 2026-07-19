import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { buildHypeDrivenQuote, quotePledge } from '../services/eventService.js';
import { quoteTotal } from '../utils/pricingCalculator.js';

function roundMoney(n) {
  return Math.round(Number(n) * 100) / 100;
}

const pricingContext = {
  eventId: 'event-1',
  hypeDrivenPricing: true,
  basePrice: 10,
  maxPrice: 100,
  maxCapacity: 100,
  activeTicketCount: 0,
};

describe('buildHypeDrivenQuote', () => {
  it('returns legacy quote shape with bonding-curve line items', () => {
    const quote = buildHypeDrivenQuote('event-1', 2, pricingContext);
    const expected = quoteTotal(0, 2, {
      basePrice: 10,
      maxPrice: 100,
      maxCapacity: 100,
    });

    assert.equal(quote.eventId, 'event-1');
    assert.equal(quote.qty, 2);
    assert.equal(quote.pricingModel, 'hype_driven');
    assert.equal(quote.lines.length, 2);
    assert.equal(quote.lines[0].count, 1);
    assert.equal(quote.lines[0].price, roundMoney(expected.unitPrices[0]));
    assert.equal(quote.lines[1].price, roundMoney(expected.unitPrices[1]));
    assert.ok(Math.abs(quote.total - roundMoney(expected.total)) < 0.01);
    assert.match(quote.totalText, /^\$\d+\.\d{2}$/);
    assert.match(quote.subtotalText, /^\$\d+\.\d{2}$/);
  });

  it('maps not_enough_tickets when quote exceeds capacity', () => {
    const quote = buildHypeDrivenQuote('event-1', 2, {
      ...pricingContext,
      activeTicketCount: 99,
    });
    assert.deepEqual(quote, { error: 'not_enough_tickets' });
  });

  it('matches the fastevent2 six-ticket bonding-curve quote from checkout', () => {
    const quote = buildHypeDrivenQuote('d9f48b5a-9692-4f13-858a-3c7e9ad7028a', 6, {
      eventId: 'd9f48b5a-9692-4f13-858a-3c7e9ad7028a',
      hypeDrivenPricing: true,
      basePrice: 10,
      maxPrice: 20,
      maxCapacity: 155,
      activeTicketCount: 10,
    });

    assert.equal(quote.total, 63.45);
    assert.deepEqual(quote.lines.map((line) => line.subtotal), [10.46, 10.5, 10.55, 10.6, 10.65, 10.69]);
  });
});

describe('quotePledge', () => {
  it('uses bonding curve when hype-driven pricing is enabled', async () => {
    let rpcCalls = 0;
    const sb = {
      rpc: async (name) => {
        if (name === 'get_events') {
          return {
            data: [{
              id: 'event-1',
              hypeDrivenPricing: true,
              basePrice: 10,
              maxPrice: 100,
              maxCapacity: 100,
              active_ticket_count: 5,
              derived_status: 'early_bird',
              statuses: [],
            }],
            error: null,
          };
        }
        if (name === 'get_quote') {
          rpcCalls += 1;
          return { data: null, error: null };
        }
        throw new Error(`unexpected rpc ${name}`);
      },
    };

    const quote = await quotePledge(sb, 'event-1', 2);
    assert.equal(rpcCalls, 0);
    assert.equal(quote.pricingModel, 'hype_driven');
    assert.equal(quote.qty, 2);
    assert.equal(quote.lines.length, 2);
  });

  it('falls back to get_quote RPC for static pricing events', async () => {
    const sb = {
      rpc: async (name, args) => {
        if (name === 'get_events') {
          return {
            data: [{
              id: 'event-1',
              hypeDrivenPricing: false,
              active_ticket_count: 5,
              derived_status: 'early_bird',
              statuses: [{ statusName: 'early_bird', price: 20, ticketCapacity: 50, sold: 5 }],
            }],
            error: null,
          };
        }
        if (name === 'get_quote') {
          return {
            data: {
              eventId: args.p_event_id,
              qty: args.p_qty,
              lines: [{ label: 'Early Birds', price: 20, count: 1 }],
              subtotal: 20,
              total: 20,
            },
            error: null,
          };
        }
        throw new Error(`unexpected rpc ${name}`);
      },
    };

    const quote = await quotePledge(sb, 'event-1', 1);
    assert.equal(quote.total, 20);
    assert.equal(quote.lines[0].label, 'Early Birds');
    assert.equal(quote.pricingModel, undefined);
  });
});
