import { describe, test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { topupWallet, dependencies } from './walletService.js';

describe('walletService', () => {
  const originalStripe = dependencies.stripe;
  const originalStripeEnabled = dependencies.stripeEnabled;
  const originalAdminClient = dependencies.adminClient;

  let createPaymentIntentArgs = null;
  let rpcCalls = null;
  let mockStripeEnabled = true;
  let mockPiAmount = null;   // null = echo what was requested, as real Stripe does
  let mockRpcResponse = { data: { balance: 150 }, error: null };

  beforeEach(() => {
    createPaymentIntentArgs = null;
    rpcCalls = null;
    mockStripeEnabled = true;
    mockPiAmount = null;
    mockRpcResponse = { data: { balance: 150 }, error: null };

    dependencies.stripeEnabled = () => mockStripeEnabled;

    dependencies.stripe = () => ({
      paymentIntents: {
        create: async (args, options) => {
          createPaymentIntentArgs = { args, options };
          // A real PaymentIntent always echoes the captured `amount` (in cents); topupWallet
          // credits the wallet from THAT, never from what the caller asked for.
          return {
            id: 'pi_mock_123',
            status: 'succeeded',
            amount: mockPiAmount ?? args.amount,
          };
        }
      }
    });

    // wallet_topup is service_role-only, so the credit goes through the admin client.
    dependencies.adminClient = () => ({
      rpc: async (name, args) => { rpcCalls = { name, args }; return mockRpcResponse; },
    });
  });

  afterEach(() => {
    dependencies.stripe = originalStripe;
    dependencies.stripeEnabled = originalStripeEnabled;
    dependencies.adminClient = originalAdminClient;
  });

  test('successfully charges stripe and credits wallet via topup RPC', async () => {
    const mockSb = {
      from: (table) => {
        if (table === 'USER') {
          return {
            select: () => ({
              eq: () => ({
                single: async () => ({
                  data: { stripeCustomerId: 'cus_abc', stripePaymentMethodId: 'pm_123' },
                  error: null
                })
              })
            })
          };
        }
      },
      rpc: async () => { throw new Error('wallet_topup must NOT go through the user client'); },
    };

    const res = await topupWallet(mockSb, 'user-id-123', 50, 'attempt-id-456');

    assert.deepEqual(res, { status: 'ok', balance: 150 });
    assert.ok(createPaymentIntentArgs);
    assert.equal(createPaymentIntentArgs.args.amount, 5000); // 50 * 100
    assert.equal(createPaymentIntentArgs.args.customer, 'cus_abc');
    assert.equal(createPaymentIntentArgs.args.payment_method, 'pm_123');
    assert.equal(createPaymentIntentArgs.options.idempotencyKey, 'topup:attempt-id-456');

    assert.ok(rpcCalls);
    assert.equal(rpcCalls.name, 'wallet_topup');
    // p_user_id comes from the validated JWT — the RPC has no auth.uid() under service_role.
    assert.deepEqual(rpcCalls.args, { p_user_id: 'user-id-123', p_amount: 50, p_payment_intent_id: 'pi_mock_123' });
  });

  test('refuses to credit when Stripe captured a different amount than requested', async () => {
    // The wallet must only ever be credited with money Stripe actually took. Guards against a
    // partial capture / mismatched PaymentIntent crediting the full requested amount.
    mockPiAmount = 100; // $1.00 captured against a $50 request
    const mockSb = {
      from: () => ({ select: () => ({ eq: () => ({ single: async () => ({ data: { stripeCustomerId: 'cus_abc', stripePaymentMethodId: 'pm_123' }, error: null }) }) }) }),
      rpc: async () => { throw new Error('should not be reached'); },
    };
    const res = await topupWallet(mockSb, 'user-id-123', 50, 'attempt-1');
    assert.equal(res.error, 'charge_mismatch');
    assert.equal(rpcCalls, null); // nothing credited
  });

  test('returns error when Stripe is disabled', async () => {
    mockStripeEnabled = false;
    const mockSb = {};
    const res = await topupWallet(mockSb, 'user-id-123', 50);
    assert.deepEqual(res, {
      error: 'stripe_disabled',
      message: 'Card payments are not configured (STRIPE_SECRET_KEY missing).'
    });
    assert.equal(createPaymentIntentArgs, null);
  });

  test('returns error when topup amount is invalid', async () => {
    const mockSb = {};
    const res = await topupWallet(mockSb, 'user-id-123', -5);
    assert.deepEqual(res, {
      error: 'bad_amount',
      message: 'Enter a valid top-up amount.'
    });
  });

  test('returns error when user has no linked card', async () => {
    const mockSb = {
      from: (table) => {
        if (table === 'USER') {
          return {
            select: () => ({
              eq: () => ({
                single: async () => ({
                  data: { stripeCustomerId: null, stripePaymentMethodId: null },
                  error: null
                })
              })
            })
          };
        }
      }
    };

    const res = await topupWallet(mockSb, 'user-id-123', 50);
    assert.deepEqual(res, {
      error: 'no_card',
      message: 'Link a card before topping up.'
    });
  });

  test('returns error when card charge fails/is declined', async () => {
    dependencies.stripe = () => ({
      paymentIntents: {
        create: async () => {
          throw new Error('Your card was declined.');
        }
      }
    });

    const mockSb = {
      from: (table) => {
        if (table === 'USER') {
          return {
            select: () => ({
              eq: () => ({
                single: async () => ({
                  data: { stripeCustomerId: 'cus_abc', stripePaymentMethodId: 'pm_123' },
                  error: null
                })
              })
            })
          };
        }
      }
    };

    const res = await topupWallet(mockSb, 'user-id-123', 50);
    assert.deepEqual(res, {
      error: 'charge_failed',
      message: 'Your card was declined.'
    });
  });

  test('returns error when Stripe charge completes but status is not succeeded', async () => {
    dependencies.stripe = () => ({
      paymentIntents: {
        create: async () => {
          return { id: 'pi_mock_123', status: 'requires_action' };
        }
      }
    });

    const mockSb = {
      from: (table) => {
        if (table === 'USER') {
          return {
            select: () => ({
              eq: () => ({
                single: async () => ({
                  data: { stripeCustomerId: 'cus_abc', stripePaymentMethodId: 'pm_123' },
                  error: null
                })
              })
            })
          };
        }
      }
    };

    const res = await topupWallet(mockSb, 'user-id-123', 50);
    assert.deepEqual(res, {
      error: 'charge_incomplete',
      message: 'Payment could not be completed.'
    });
  });

  test('returns error when wallet_topup RPC fails', async () => {
    const mockSb = {
      from: (table) => {
        if (table === 'USER') {
          return {
            select: () => ({
              eq: () => ({
                single: async () => ({
                  data: { stripeCustomerId: 'cus_abc', stripePaymentMethodId: 'pm_123' },
                  error: null
                })
              })
            })
          };
        }
      },
      rpc: async () => { throw new Error('wallet_topup must NOT go through the user client'); },
    };
    mockRpcResponse = { data: null, error: { message: 'Database lock timeout' } };

    const res = await topupWallet(mockSb, 'user-id-123', 50);
    assert.deepEqual(res, {
      error: 'error',
      message: 'Database lock timeout'
    });
  });
});
