import { randomUUID } from 'crypto';
import { stripe, stripeEnabled } from './stripeClient.js';
import { adminClient } from './supabaseAdmin.js';
import { auditLog } from './auditLog.js';

export const dependencies = {
  stripe,
  stripeEnabled,
  adminClient,
};

// Per-transaction top-up ceiling. The frontend caps too, but that is bypassable (this service
// also backs the AI agent's topup action and the HTTP endpoint is directly callable), so this is
// the authoritative limit.
const MAX_TOPUP = 200;

// Shared wallet top-up core: charge the user's linked card, then credit the wallet
// via the wallet_topup RPC. Used by both the HTTP controller (POST /api/wallet/topup)
// and the AI agent's confirmed `topup` action so the two never diverge. Never throws —
// returns a tagged result.
//
// Reads (the user's linked card) go through the caller's own RLS-scoped client. The CREDIT
// goes through service_role: Postgres can't verify a Stripe charge, so wallet_topup is not
// callable by end users — it used to be, and validated only that the amount was positive,
// which meant any logged-in user could mint themselves unlimited balance.
export async function topupWallet(sb, userId, amount, attemptId = randomUUID()) {
  if (!dependencies.stripeEnabled()) return { error: 'stripe_disabled', message: 'Card payments are not configured (STRIPE_SECRET_KEY missing).' };
  const amt = Number(amount);
  if (!amt || amt <= 0) return { error: 'bad_amount', message: 'Enter a valid top-up amount.' };
  if (amt > MAX_TOPUP) return { error: 'bad_amount', message: `Top-ups are capped at $${MAX_TOPUP} per transaction.` };

  const { data: me } = await sb.from('USER').select('stripeCustomerId, stripePaymentMethodId').eq('id', userId).single();
  if (!me?.stripeCustomerId || !me?.stripePaymentMethodId) {
    return { error: 'no_card', message: 'Link a card before topping up.' };
  }

  let pi;
  try {
    pi = await dependencies.stripe().paymentIntents.create({
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
  // Credit exactly what Stripe captured, never what the caller asked for.
  if (Number(pi.amount) !== Math.round(amt * 100)) {
    return { error: 'charge_mismatch', message: 'The charged amount did not match the top-up.' };
  }

  // service_role only: Postgres cannot verify a Stripe charge, so a user-callable top-up would
  // mint money (it used to — the RPC validated only that the amount was positive). This is the
  // one place allowed to say "this card charge really happened", and only after checking it.
  const { data, error } = await dependencies.adminClient().rpc('wallet_topup', {
    p_user_id: userId,
    p_amount: amt,
    p_payment_intent_id: pi.id,
  });
  // The charge already SUCCEEDED. A transport/RPC failure here must NOT tell the user their money
  // vanished — the paymentReconciler sweeps succeeded top-up PIs with no wallet credit and credits
  // them (idempotent via wallet_txn_stripe_pi_uniq), so the balance lands within a sweep or two.
  if (error) return { error: 'credit_pending', message: 'Payment received — your wallet will be credited shortly.' };
  if (data?.error) return { error: data.error, message: 'Could not credit your wallet.' };
  void auditLog({ actorUserId: userId, action: 'wallet_topup', targetType: 'wallet', targetId: userId, amount: amt, metadata: { paymentIntentId: pi.id } });
  return { status: 'ok', balance: data?.balance };
}

