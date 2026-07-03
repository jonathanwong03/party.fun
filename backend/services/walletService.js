import { randomUUID } from 'crypto';
import { stripe, stripeEnabled } from './stripeClient.js';

// Shared wallet top-up core: charge the user's linked card, then credit the wallet
// via the wallet_topup RPC. Used by both the HTTP controller (POST /api/wallet/topup)
// and the AI agent's confirmed `topup` action so the two never diverge. Runs through
// the caller's own (RLS-scoped) Supabase client. Never throws — returns a tagged result.
export async function topupWallet(sb, userId, amount, attemptId = randomUUID()) {
  if (!stripeEnabled()) return { error: 'stripe_disabled', message: 'Card payments are not configured (STRIPE_SECRET_KEY missing).' };
  const amt = Number(amount);
  if (!amt || amt <= 0) return { error: 'bad_amount', message: 'Enter a valid top-up amount.' };

  const { data: me } = await sb.from('USER').select('stripeCustomerId, stripePaymentMethodId').eq('id', userId).single();
  if (!me?.stripeCustomerId || !me?.stripePaymentMethodId) {
    return { error: 'no_card', message: 'Link a card before topping up.' };
  }

  let pi;
  try {
    pi = await stripe().paymentIntents.create({
      amount: Math.round(amt * 100),
      currency: 'sgd',
      customer: me.stripeCustomerId,
      payment_method: me.stripePaymentMethodId,
      off_session: true,
      confirm: true,
      metadata: { kind: 'topup', userId, attemptId },
    }, { idempotencyKey: `topup:${attemptId}` });
  } catch (e) {
    return { error: 'charge_failed', message: e?.message || 'Your card was declined.' };
  }
  if (pi.status !== 'succeeded') return { error: 'charge_incomplete', message: 'Payment could not be completed.' };

  const { data, error } = await sb.rpc('wallet_topup', { p_amount: amt, p_payment_intent_id: pi.id });
  if (error) return { error: 'error', message: error.message };
  return { status: 'ok', balance: data?.balance };
}
