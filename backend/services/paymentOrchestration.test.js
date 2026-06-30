import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';

// stripeEnabled() reads this at call time; set it so the card/reconcile paths are exercised.
process.env.STRIPE_SECRET_KEY = process.env.STRIPE_SECRET_KEY || 'sk_test_dummy';

import { canRefund } from './refundPolicy.js';
import * as reconciler from './paymentReconciler.js';
import { postPledge, dependencies as checkout } from '../controllers/checkoutController.js';

const DAY = 24 * 60 * 60 * 1000;
const ATTEMPT = '11111111-1111-4111-8111-111111111111';

// ── refund-window helper ──────────────────────────────────────────────────────
describe('canRefund (refund window)', () => {
  it('allows a charge inside the window (179 days)', () => {
    assert.equal(canRefund(new Date(Date.now() - 179 * DAY).toISOString()), true);
  });
  it('blocks a charge past the window (181 days)', () => {
    assert.equal(canRefund(new Date(Date.now() - 181 * DAY).toISOString()), false);
  });
  it('treats null/invalid chargeAt as refundable (Stripe is source of truth)', () => {
    assert.equal(canRefund(null), true);
    assert.equal(canRefund('not-a-date'), true);
  });
  it('honours a custom window', () => {
    assert.equal(canRefund(new Date(Date.now() - 10 * DAY).toISOString(), 5), false);
  });
});

// ── reconciliation sweeper (orphan recovery) ───────────────────────────────────
function stripeMock({ pis = [], onRefund, listThrows = false } = {}) {
  return {
    paymentIntents: {
      list: () => {
        if (listThrows) throw new Error('stripe down');
        return (async function* () { for (const p of pis) yield p; })();
      },
    },
    refunds: { create: async (params, opts) => { onRefund?.(params, opts); return { id: 're_' + params.payment_intent }; } },
  };
}
function adminMock(bookingsByPi = {}) {
  return { from: () => ({ select: () => ({ eq: (_c, v) => ({ maybeSingle: async () => ({ data: bookingsByPi[v] ?? null }) }) }) }) };
}
const succeededPledge = (id, ageDays = 0) => ({ id, status: 'succeeded', metadata: { kind: 'pledge' }, created: Math.floor((Date.now() - ageDays * DAY) / 1000) });

describe('reconcilePayments (orphan recovery)', () => {
  const original = { ...reconciler.dependencies };
  afterEach(() => Object.assign(reconciler.dependencies, original));

  it('refunds a succeeded pledge PI that has no booking (idempotent key)', async () => {
    const refunds = [];
    reconciler.dependencies.getStripe = () => stripeMock({ pis: [succeededPledge('pi_1')], onRefund: (p, o) => refunds.push({ p, o }) });
    reconciler.dependencies.getAdmin = () => adminMock({}); // no booking for pi_1
    const result = await reconciler.reconcilePayments();
    assert.deepEqual(result, { scanned: 1, refunded: 1 });
    assert.equal(refunds.length, 1);
    assert.equal(refunds[0].p.payment_intent, 'pi_1');
    assert.equal(refunds[0].o.idempotencyKey, 'orphan:pi_1');
  });

  it('does not refund when a booking already exists for the PI', async () => {
    let refunded = 0;
    reconciler.dependencies.getStripe = () => stripeMock({ pis: [succeededPledge('pi_2')], onRefund: () => { refunded += 1; } });
    reconciler.dependencies.getAdmin = () => adminMock({ pi_2: { id: 99 } });
    const result = await reconciler.reconcilePayments();
    assert.equal(refunded, 0);
    assert.equal(result.refunded, 0);
  });

  it('skips non-pledge and non-succeeded PaymentIntents', async () => {
    let refunded = 0;
    const pis = [
      { id: 'pi_topup', status: 'succeeded', metadata: { kind: 'topup' } },
      { id: 'pi_fail', status: 'requires_payment_method', metadata: { kind: 'pledge' } },
    ];
    reconciler.dependencies.getStripe = () => stripeMock({ pis, onRefund: () => { refunded += 1; } });
    reconciler.dependencies.getAdmin = () => adminMock({});
    const result = await reconciler.reconcilePayments();
    assert.equal(result.scanned, 0);
    assert.equal(refunded, 0);
  });

  it('does not refund an orphan that is past the refund window', async () => {
    let refunded = 0;
    reconciler.dependencies.getStripe = () => stripeMock({ pis: [succeededPledge('pi_old', 200)], onRefund: () => { refunded += 1; } });
    reconciler.dependencies.getAdmin = () => adminMock({});
    const result = await reconciler.reconcilePayments();
    assert.equal(refunded, 0);
    assert.equal(result.refunded, 0);
  });

  it('never throws if Stripe errors', async () => {
    reconciler.dependencies.getStripe = () => stripeMock({ listThrows: true });
    reconciler.dependencies.getAdmin = () => adminMock({});
    const result = await reconciler.reconcilePayments();
    assert.deepEqual(result, { scanned: 0, refunded: 0 });
  });
});

// ── checkout orchestration (idempotency keys + compensating refund) ────────────
function makeRes() {
  return { statusCode: 200, body: null, status(c) { this.statusCode = c; return this; }, json(b) { this.body = b; return this; } };
}
function cardSupabase(card = { stripeCustomerId: 'cus_1', stripePaymentMethodId: 'pm_1' }) {
  return { from: () => ({ select: () => ({ eq: () => ({ single: async () => ({ data: card }) }) }) }) };
}
function makeReq(over = {}) {
  return {
    params: { eventId: 'e1' },
    user: { id: 'u1' },
    body: { qty: 1, paymentMethod: 'card', attemptId: ATTEMPT },
    supabase: cardSupabase(),
    ...over,
  };
}

describe('postPledge orchestration', () => {
  const original = { ...checkout };
  beforeEach(() => Object.assign(checkout, original));
  afterEach(() => Object.assign(checkout, original));

  it('503 when card chosen but Stripe is disabled', async () => {
    checkout.getEvent = async () => ({ id: 'e1' });
    checkout.stripeEnabled = () => false;
    const res = makeRes();
    await postPledge(makeReq(), res);
    assert.equal(res.statusCode, 503);
    assert.equal(res.body.status, 'stripe_disabled');
  });

  it('charges with idempotencyKey pledge:<attemptId> and passes attemptId to createPledge', async () => {
    let piOpts = null;
    let createPledgeArgs = null;
    checkout.stripeEnabled = () => true;
    checkout.getEvent = async () => ({ id: 'e1', title: 'E' });
    checkout.quotePledge = async () => ({ total: 25 });
    checkout.getStripe = () => ({
      paymentIntents: { create: async (_p, opts) => { piOpts = opts; return { id: 'pi_9', status: 'succeeded' }; } },
      refunds: { create: async () => ({ id: 're_x' }) },
    });
    // Force the record step to fail so we stop before the (heavy) success path.
    checkout.createPledge = async (...args) => { createPledgeArgs = args; return { error: 'not_enough_tickets' }; };
    const res = makeRes();
    await postPledge(makeReq(), res);
    assert.equal(piOpts.idempotencyKey, `pledge:${ATTEMPT}`);
    assert.equal(createPledgeArgs[7], ATTEMPT); // 8th arg = idempotencyKey
    assert.equal(res.statusCode, 409);
    assert.equal(res.body.status, 'not_enough_tickets');
  });

  it('issues a compensating refund (idempotent) when the booking fails after a successful charge', async () => {
    let refundCall = null;
    checkout.stripeEnabled = () => true;
    checkout.getEvent = async () => ({ id: 'e1' });
    checkout.quotePledge = async () => ({ total: 25 });
    checkout.getStripe = () => ({
      paymentIntents: { create: async () => ({ id: 'pi_9', status: 'succeeded' }) },
      refunds: { create: async (params, opts) => { refundCall = { params, opts }; return { id: 're_9' }; } },
    });
    checkout.createPledge = async () => ({ error: 'insufficient_funds' });
    const res = makeRes();
    await postPledge(makeReq(), res);
    assert.ok(refundCall, 'a refund should be attempted');
    assert.equal(refundCall.params.payment_intent, 'pi_9');
    assert.equal(refundCall.opts.idempotencyKey, 'refund:pi_9');
  });

  it('does NOT charge again / does not refund on a declined card', async () => {
    let createPledgeCalled = false;
    let refundCalled = false;
    checkout.stripeEnabled = () => true;
    checkout.getEvent = async () => ({ id: 'e1' });
    checkout.quotePledge = async () => ({ total: 25 });
    checkout.getStripe = () => ({
      paymentIntents: { create: async () => { throw new Error('card declined'); } },
      refunds: { create: async () => { refundCalled = true; return {}; } },
    });
    checkout.createPledge = async () => { createPledgeCalled = true; return { error: 'x' }; };
    const res = makeRes();
    await postPledge(makeReq(), res);
    assert.equal(res.statusCode, 402);
    assert.equal(res.body.status, 'charge_failed');
    assert.equal(createPledgeCalled, false, 'no booking attempt after a failed charge');
    assert.equal(refundCalled, false, 'nothing to refund — no charge succeeded');
  });

  it('wallet path: insufficient funds returns 402 without touching Stripe', async () => {
    let stripeTouched = false;
    checkout.getEvent = async () => ({ id: 'e1' });
    checkout.getStripe = () => { stripeTouched = true; return {}; };
    checkout.createPledge = async (...args) => { assert.equal(args[7], ATTEMPT); return { error: 'insufficient_funds' }; };
    const res = makeRes();
    await postPledge(makeReq({ body: { qty: 1, paymentMethod: 'wallet', attemptId: ATTEMPT } }), res);
    assert.equal(res.statusCode, 402);
    assert.equal(res.body.status, 'insufficient_funds');
    assert.equal(stripeTouched, false);
  });
});
