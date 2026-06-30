import { randomUUID } from 'crypto';
import { stripe, stripeEnabled } from '../services/stripeClient.js';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const attemptIdOf = (body) => (UUID_RE.test(body?.attemptId ?? '') ? body.attemptId : randomUUID());

const stripeOff = (res) =>
  res.status(503).json({ status: 'stripe_disabled', message: 'Card payments are not configured (STRIPE_SECRET_KEY missing).' });

// Ensure the caller has a Stripe Customer; create + persist one if needed.
async function ensureCustomer(req) {
  const { data: me } = await req.supabase.from('USER').select('email, username, stripeCustomerId').eq('id', req.user.id).single();
  if (me?.stripeCustomerId) return me.stripeCustomerId;
  const customer = await stripe().customers.create({
    email: me?.email || undefined,
    name: me?.username || undefined,
    metadata: { userId: req.user.id },
  });
  await req.supabase.from('USER').update({ stripeCustomerId: customer.id }).eq('id', req.user.id);
  return customer.id;
}

// GET /api/wallet — balance, linked card, recent transactions.
export async function getWallet(req, res) {
  const { data: me } = await req.supabase.from('USER').select('walletBalance, cardBrand, cardLast4').eq('id', req.user.id).single();
  const { data: txns } = await req.supabase
    .from('WALLET_TRANSACTIONS')
    .select('id, type, source, amount, balanceAfter, eventId, createdAt')
    .order('createdAt', { ascending: false })
    .limit(50);
  res.json({
    balance: Number(me?.walletBalance ?? 0),
    card: me?.cardLast4 ? { brand: me.cardBrand, last4: me.cardLast4 } : null,
    transactions: txns ?? [],
  });
}

// POST /api/wallet/setup-intent — start linking a card (returns a SetupIntent client secret).
export async function postSetupIntent(req, res) {
  if (!stripeEnabled()) return stripeOff(res);
  const customerId = await ensureCustomer(req);
  const si = await stripe().setupIntents.create({ customer: customerId, payment_method_types: ['card'] });
  res.json({ clientSecret: si.client_secret });
}

// POST /api/wallet/card — save the confirmed PaymentMethod as the user's default card.
export async function postCard(req, res) {
  if (!stripeEnabled()) return stripeOff(res);
  const paymentMethodId = req.body?.paymentMethodId;
  if (!paymentMethodId) { res.status(400).json({ message: 'Missing payment method.' }); return; }
  const customerId = await ensureCustomer(req);
  try { await stripe().paymentMethods.attach(paymentMethodId, { customer: customerId }); } catch { /* already attached via SetupIntent */ }
  await stripe().customers.update(customerId, { invoice_settings: { default_payment_method: paymentMethodId } });
  const pm = await stripe().paymentMethods.retrieve(paymentMethodId);
  await req.supabase.from('USER').update({
    stripePaymentMethodId: paymentMethodId,
    cardBrand: pm.card?.brand ?? null,
    cardLast4: pm.card?.last4 ?? null,
  }).eq('id', req.user.id);
  res.json({ card: { brand: pm.card?.brand ?? null, last4: pm.card?.last4 ?? null } });
}

// POST /api/wallet/topup { amount } — charge the linked card, then credit the wallet.
export async function postTopup(req, res) {
  if (!stripeEnabled()) return stripeOff(res);
  const amount = Number(req.body?.amount);
  if (!amount || amount <= 0) { res.status(400).json({ message: 'Enter a valid top-up amount.' }); return; }
  const { data: me } = await req.supabase.from('USER').select('stripeCustomerId, stripePaymentMethodId').eq('id', req.user.id).single();
  if (!me?.stripeCustomerId || !me?.stripePaymentMethodId) {
    res.status(400).json({ status: 'no_card', message: 'Link a card before topping up.' });
    return;
  }
  const attemptId = attemptIdOf(req.body);
  let pi;
  try {
    pi = await stripe().paymentIntents.create({
      amount: Math.round(amount * 100),
      currency: 'sgd',
      customer: me.stripeCustomerId,
      payment_method: me.stripePaymentMethodId,
      off_session: true,
      confirm: true,
      metadata: { kind: 'topup', userId: req.user.id, attemptId },
    }, { idempotencyKey: `topup:${attemptId}` });
  } catch (e) {
    res.status(402).json({ status: 'charge_failed', message: e?.message || 'Your card was declined.' });
    return;
  }
  if (pi.status !== 'succeeded') { res.status(402).json({ status: 'charge_incomplete', message: 'Payment could not be completed.' }); return; }
  const { data, error } = await req.supabase.rpc('wallet_topup', { p_amount: amount, p_payment_intent_id: pi.id });
  if (error) { res.status(500).json({ message: error.message }); return; }
  res.json({ status: 'ok', balance: data?.balance });
}
