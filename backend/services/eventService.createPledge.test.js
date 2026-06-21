import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createPledge } from './eventService.js';

describe('createPledge', () => {
  it('passes charged amount to create_pledge for card payment validation', async () => {
    const rpcArgs = [];
    const sb = {
      rpc: async (name, args) => {
        rpcArgs.push({ name, args });
        if (name === 'create_pledge') {
          return {
            data: { status: 'ok', reference: 'PF-ABCD-1234', amount: 20.23, bookingId: '99' },
            error: null,
          };
        }
        if (name === 'get_events') return { data: [], error: null };
        if (name === 'get_profile') {
          return { data: { profile: { email: 'u@test.com' }, tickets: [] }, error: null };
        }
        throw new Error(`unexpected rpc ${name}`);
      },
    };

    const result = await createPledge(sb, 'user-1', 'event-1', 2, 'card', 'pi_123', 20.23);

    assert.equal(rpcArgs[0].name, 'create_pledge');
    assert.equal(rpcArgs[0].args.p_charged_amount, 20.23);
    assert.equal(rpcArgs[0].args.p_payment_method, 'card');
    assert.equal(rpcArgs[0].args.p_payment_intent_id, 'pi_123');
    assert.equal(result.amount, 20.23);
    assert.equal(result.reference, 'PF-ABCD-1234');
  });

  it('omits charged amount for wallet pledges', async () => {
    let pledgeArgs = null;
    const sb = {
      rpc: async (name, args) => {
        if (name === 'create_pledge') {
          pledgeArgs = args;
          return { data: { status: 'ok', reference: 'PF-WLLT-0001', amount: 30, bookingId: '1' }, error: null };
        }
        if (name === 'get_events') return { data: [], error: null };
        if (name === 'get_profile') return { data: { profile: {}, tickets: [] }, error: null };
        throw new Error(`unexpected rpc ${name}`);
      },
    };

    await createPledge(sb, 'user-1', 'event-1', 3, 'wallet', null, null);

    assert.equal(pledgeArgs.p_charged_amount, null);
    assert.equal(pledgeArgs.p_payment_method, 'wallet');
  });
});
