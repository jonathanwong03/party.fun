import Stripe from 'stripe';

// Stripe client (Test mode). The secret key is server-only. When it's unset, the
// app falls back to the simulated/wallet-only paths so it still runs without Stripe.
let cached = null;

export function stripeEnabled() {
  return !!process.env.STRIPE_SECRET_KEY;
}

export function stripe() {
  if (!process.env.STRIPE_SECRET_KEY) {
    throw new Error('STRIPE_SECRET_KEY is not set — card payments/refunds are unavailable.');
  }
  // Bound network time so a slow Stripe call can't hang a request thread; one retry covers a
  // transient blip without risking a duplicate side effect (charges/refunds carry idempotency keys).
  if (!cached) cached = new Stripe(process.env.STRIPE_SECRET_KEY, { timeout: 20000, maxNetworkRetries: 1 });
  return cached;
}
