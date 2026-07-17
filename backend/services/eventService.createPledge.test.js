import { describe, it, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { createPledge, dependencies } from './eventService.js';

// createPledge routes by trust: a WALLET pledge goes through the user's own RLS-scoped client
// (create_pledge, auth.uid(), no payment params to forge); a CARD pledge asserts "Stripe was
// charged", which Postgres can't verify, so it goes through the service_role client
// (create_pledge_card) with a JWT-validated user id. These tests pin that split — when both
// lived in one `authenticated` RPC that trusted the caller's word, anyone could mint tickets.

const realAdminClient = dependencies.adminClient;
afterEach(() => { dependencies.adminClient = realAdminClient; });

// Records every rpc call made through the admin (service_role) client.
function stubAdmin(calls, response = { data: { status: 'ok', reference: 'PF-CARD-0001', amount: 20.23, bookingId: '99' }, error: null }) {
  dependencies.adminClient = () => ({
    rpc: async (name, args) => { calls.push({ name, args }); return response; },
  });
}

// A user-scoped client that serves the reads createPledge does after a successful pledge.
function userSb(calls, response = { data: { status: 'ok', reference: 'PF-WLLT-0001', amount: 30, bookingId: '1' }, error: null }) {
  return {
    rpc: async (name, args) => {
      if (name === 'get_events') return { data: [], error: null };
      if (name === 'get_profile') return { data: { profile: { email: 'u@test.com' }, tickets: [] }, error: null };
      calls.push({ name, args });
      return response;
    },
  };
}

describe('createPledge', () => {
  it('sends a CARD pledge to create_pledge_card via the service-role client, with proof', async () => {
    const adminCalls = [];
    const userCalls = [];
    stubAdmin(adminCalls);
    const result = await createPledge(userSb(userCalls), 'user-1', 'event-1', 2, 'card', 'pi_123', 20.23, 'attempt-1');

    assert.equal(adminCalls.length, 1);
    assert.equal(adminCalls[0].name, 'create_pledge_card');
    assert.equal(adminCalls[0].args.p_user_id, 'user-1'); // identity comes from the backend, not auth.uid()
    assert.equal(adminCalls[0].args.p_payment_intent_id, 'pi_123');
    assert.equal(adminCalls[0].args.p_charged_amount, 20.23);
    assert.equal(result.amount, 20.23);
    assert.equal(result.reference, 'PF-CARD-0001');
    // The card path must NEVER go through the user's client — that RPC is service_role-only.
    assert.equal(userCalls.length, 0);
  });

  it('sends a WALLET pledge to create_pledge on the user client, with NO payment params', async () => {
    const adminCalls = [];
    const userCalls = [];
    stubAdmin(adminCalls);
    await createPledge(userSb(userCalls), 'user-1', 'event-1', 3, 'wallet', null, null, 'attempt-2');

    assert.equal(userCalls.length, 1);
    assert.equal(userCalls[0].name, 'create_pledge');
    assert.deepEqual(Object.keys(userCalls[0].args).sort(), ['p_event_id', 'p_idempotency_key', 'p_qty']);
    // The security property: a user-callable pledge has nothing to forge. If any of these ever
    // reappear on this RPC, `card` + null amount skips both money paths again → free tickets.
    for (const forgeable of ['p_payment_method', 'p_payment_intent_id', 'p_charged_amount']) {
      assert.ok(!(forgeable in userCalls[0].args), `wallet create_pledge must not accept ${forgeable}`);
    }
    assert.equal(adminCalls.length, 0); // a wallet pledge needs no service-role key
  });

  it('RETURNS an rpc error instead of throwing, so the compensating refund can run', async () => {
    // pledgeWithPayment only refunds a successful card charge inside `if (result?.error)`.
    // This used to `throw`, jumping past that block and stranding the charge.
    const adminCalls = [];
    stubAdmin(adminCalls, { data: null, error: { message: 'statement timeout' } });
    const result = await createPledge(userSb([]), 'user-1', 'event-1', 1, 'card', 'pi_x', 10, 'attempt-3');
    assert.equal(result.error, 'error');
    assert.match(result.message, /statement timeout/);
  });
});
