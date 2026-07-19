import { randomUUID } from 'crypto';
import { stripe, stripeEnabled } from '../services/stripeClient.js';
import { topupWallet } from '../services/walletService.js';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const attemptIdOf = (body) => (UUID_RE.test(body?.attemptId ?? '') ? body.attemptId : randomUUID());

// HTTP status for each tagged topupWallet error.
const TOPUP_STATUS = { stripe_disabled: 503, bad_amount: 400, no_card: 400, charge_failed: 402, charge_incomplete: 402, credit_pending: 202, error: 500 };

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
// Delegates to the shared topupWallet service (reused by the AI agent's topup action).
export async function postTopup(req, res) {
  const result = await topupWallet(req.supabase, req.user.id, req.body?.amount, attemptIdOf(req.body));
  if (result.error) {
    return res.status(TOPUP_STATUS[result.error] ?? 400).json({ status: result.error, message: result.message });
  }
  res.json({ status: 'ok', balance: result.balance });
}
