// DB-integration tests for the money-critical Postgres RPCs (create_pledge,
// wallet_topup) and their unique indexes — the guarantees the mock-based unit tests
// can't reach. Skips entirely unless a test Supabase (branch/local) is configured;
// see helpers.js. Run with:  npm run test:integration
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createEvent } from '../../services/eventService.js';
import {
  integrationSkip, makeUser, deleteUser, setWalletBalance, getWalletBalance,
  countBookings, futureIso, admin,
} from './helpers.js';

describe('payment RPC integration', { skip: integrationSkip }, () => {
  let organiser;
  let eventId;
  const buyers = []; // tracked for cleanup

  // Seed one organiser + one tiered event (early-bird $10, greenlit $16) via the real
  // create_event path, so every table (EVENT / EVENT_SETTINGS / PRICE_STATUSES) is set
  // up exactly as production does.
  before(async () => {
    organiser = await makeUser({ role: 'organiser' });
    const res = await createEvent(organiser.client, {
      title: `ITest Event ${Date.now()}`,
      description: 'Integration test event.',
      location: 'Test Hall',
      address: '123 Test Rd',
      startsAt: futureIso(21),
      endsAt: futureIso(21, 22),
      deadlineAt: futureIso(14),
      image: '',
      hypeThreshold: 5,
      maxCapacity: 100,
      statuses: [
        { statusName: 'early_bird', price: 10, qty: 50 },
        { statusName: 'greenlit', price: 16, qty: 50 },
      ],
      hypeDrivenPricing: false,
    });
    assert.ok(res.eventId, `event seed failed: ${JSON.stringify(res)}`);
    eventId = res.eventId;
  });

  after(async () => {
    // Remove the event (admin) + all test users.
    if (eventId) { try { await admin().from('EVENT').delete().eq('id', eventId); } catch { /* cascade */ } }
    await Promise.all([organiser && deleteUser(organiser.id), ...buyers.map((b) => deleteUser(b.id))]);
  });

  async function newBuyer(balance = 100) {
    const b = await makeUser({ role: 'user' });
    buyers.push(b);
    await setWalletBalance(b.id, balance);
    return b;
  }

  // A wallet pledge as the signed-in user: the only pledge path an end user may call.
  // It takes no payment parameters — there is deliberately nothing here to forge.
  const pledge = (client, args) => client.rpc('create_pledge', {
    p_event_id: eventId, p_qty: 1, p_idempotency_key: null, ...args,
  });

  // 1. Idempotent replay: same key twice → one booking, one debit.
  it('create_pledge is idempotent on a repeated idempotency key (no double charge)', async () => {
    const b = await newBuyer(100);
    const key = `it-idem-${Date.now()}`;
    const first = await pledge(b.client, { p_idempotency_key: key });
    assert.equal(first.error, null, `first pledge errored: ${first.error?.message}`);
    assert.equal(first.data?.status, 'ok');

    const second = await pledge(b.client, { p_idempotency_key: key });
    assert.equal(second.error, null);
    assert.equal(second.data?.idempotent, true, 'replay should return the original booking');
    assert.equal(second.data.bookingId, first.data.bookingId);

    assert.equal(await countBookings(b.id, eventId), 1, 'exactly one booking exists');
    assert.equal(await getWalletBalance(b.id), 90, 'wallet debited exactly once ($10)');
  });

  // 2. Concurrency race: two identical submits at once → still one booking.
  it('two concurrent pledges with the same key create only one booking', async () => {
    const b = await newBuyer(100);
    const key = `it-race-${Date.now()}`;
    await Promise.allSettled([
      pledge(b.client, { p_idempotency_key: key }),
      pledge(b.client, { p_idempotency_key: key }),
    ]);
    assert.equal(await countBookings(b.id, eventId), 1, 'the unique index prevents a second booking');
    assert.equal(await getWalletBalance(b.id), 90, 'charged once');
  });

  // 3. Stripe PaymentIntent uniqueness: same PI can't back two bookings.
  it('rejects a second booking that reuses a stripePaymentIntentId', async () => {
    const b1 = await newBuyer(0); // card path — wallet balance irrelevant
    const b2 = await newBuyer(0);
    const pi = `pi_dup_${Date.now()}`;
    const cardArgs = { p_payment_method: 'card', p_payment_intent_id: pi, p_charged_amount: 10 };

    const first = await pledge(b1.client, cardArgs);
    assert.equal(first.error, null, `first card pledge errored: ${first.error?.message}`);
    assert.equal(first.data?.status, 'ok');

    const second = await pledge(b2.client, cardArgs); // same PI, different buyer
    const rejected = !!second.error || second.data?.error || second.data?.status !== 'ok';
    assert.ok(rejected, 'reusing a PaymentIntent must be rejected');
    assert.equal(await countBookings(b2.id, eventId), 0, 'no booking for the duplicate PI');
  });

  // 4. Price tamper: charged amount != recomputed total → price_mismatch, no booking.
  it('rejects a card pledge whose charged amount does not match the server total', async () => {
    const b = await newBuyer(0);
    const res = await pledge(b.client, {
      p_payment_method: 'card', p_payment_intent_id: `pi_pm_${Date.now()}`, p_charged_amount: 12, // real total is 10
    });
    assert.equal(res.data?.error, 'price_mismatch', `expected price_mismatch, got ${JSON.stringify(res.data ?? res.error)}`);
    assert.equal(await countBookings(b.id, eventId), 0);
  });

  // 5a. Wallet can't overspend: over-balance pledge fails and leaves the balance intact.
  it('rejects a wallet pledge above balance and leaves the balance unchanged', async () => {
    const b = await newBuyer(5); // needs $10, has $5
    const res = await pledge(b.client, {});
    assert.equal(res.data?.error, 'insufficient_funds');
    assert.equal(await getWalletBalance(b.id), 5, 'balance untouched on failure');
    assert.equal(await countBookings(b.id, eventId), 0);
  });

  // 5b. Wallet atomicity under concurrency: balance never goes negative.
  it('never lets the wallet go negative under concurrent pledges', async () => {
    const b = await newBuyer(10); // enough for exactly one $10 ticket
    await Promise.allSettled([
      pledge(b.client, { p_idempotency_key: `it-w1-${Date.now()}` }),
      pledge(b.client, { p_idempotency_key: `it-w2-${Date.now()}` }),
    ]);
    const bal = await getWalletBalance(b.id);
    assert.ok(bal >= 0, `balance went negative: ${bal}`);
    assert.equal(await countBookings(b.id, eventId), 1, 'only one pledge succeeded');
    assert.equal(bal, 0, 'exactly one $10 debit');
  });

  // 6. Top-up idempotency: same PaymentIntent credits the wallet once.
  //    wallet_topup is service_role-only now (see the authz block below), so this runs as the
  //    backend does — via admin() — not as the user.
  it('wallet_topup credits only once for a repeated PaymentIntent', async () => {
    const b = await newBuyer(0);
    const pi = `pi_topup_${Date.now()}`;
    const topup = () => admin().rpc('wallet_topup', { p_user_id: b.id, p_amount: 25, p_payment_intent_id: pi });
    const first = await topup();
    assert.equal(first.error, null, `first topup errored: ${first.error?.message}`);
    const second = await topup();
    // Either the RPC returns the same balance or errors on the unique index — but the
    // wallet must not be credited twice.
    assert.ok(second.error || second.data, 'second topup handled');
    assert.equal(await getWalletBalance(b.id), 25, 'credited exactly once');
  });

  // ── Authorization: an end user must not be able to mint money ────────────────
  // These are the regression tests for a real vulnerability. The browser holds a genuine
  // Supabase JWT and the anon key ships in the bundle, so ANY account holder could call these
  // RPCs directly and bypass the Express backend entirely. `b.client` below is exactly that
  // attacker: a normal signed-in user's client. Every assertion here must FAIL to buy.

  it('a signed-in user CANNOT mint wallet balance (wallet_topup is service_role-only)', async () => {
    const b = await newBuyer(0);
    // Previously: validated only p_amount > 0, so this credited $100,000 against a fake PI.
    const res = await b.client.rpc('wallet_topup', { p_user_id: b.id, p_amount: 100000, p_payment_intent_id: 'pi_fake' });
    assert.ok(res.error || res.data?.error, 'topup must be refused for an end user');
    assert.equal(await getWalletBalance(b.id), 0, 'no balance was minted');
  });

  it('a signed-in user CANNOT mint free tickets (create_pledge takes no payment params)', async () => {
    const b = await newBuyer(0); // no money at all
    // The original exploit: method='card' skipped the wallet debit, and a NULL charged_amount
    // skipped the amount check, so neither money path ran.
    const res = await b.client.rpc('create_pledge', {
      p_event_id: eventId, p_qty: 5, p_payment_method: 'card',
      p_payment_intent_id: null, p_charged_amount: null, p_idempotency_key: null,
    });
    assert.ok(res.error, 'the old payment-carrying signature must no longer exist');
    assert.equal(await countBookings(b.id, eventId), 0, 'no booking was created');
    assert.equal(await getWalletBalance(b.id), 0);
  });

  it('a signed-in user CANNOT call create_pledge_card directly', async () => {
    const b = await newBuyer(0);
    const res = await b.client.rpc('create_pledge_card', {
      p_user_id: b.id, p_event_id: eventId, p_qty: 5,
      p_payment_intent_id: 'pi_fake', p_charged_amount: 0.01, p_idempotency_key: null,
    });
    // Refused by the GRANT, or by the auth.uid()-is-not-null guard if a grant is ever fumbled.
    assert.ok(res.error || res.data?.error === 'forbidden', 'card pledge must be service_role-only');
    assert.equal(await countBookings(b.id, eventId), 0, 'no booking was created');
  });

  it('even via service_role, a card pledge without payment proof is refused', async () => {
    // Defence in depth: the backend is trusted to have charged Stripe, but the RPC still
    // refuses to record a card booking that carries no PaymentIntent + amount.
    const b = await newBuyer(0);
    const res = await admin().rpc('create_pledge_card', {
      p_user_id: b.id, p_event_id: eventId, p_qty: 1,
      p_payment_intent_id: null, p_charged_amount: null, p_idempotency_key: null,
    });
    assert.equal(res.error, null, `rpc errored: ${res.error?.message}`);
    assert.equal(res.data?.error, 'payment_proof_required');
    assert.equal(await countBookings(b.id, eventId), 0, 'no booking was created');
  });
});
