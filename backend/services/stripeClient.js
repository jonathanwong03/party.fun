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
  if (!cached) cached = new Stripe(process.env.STRIPE_SECRET_KEY);
  return cached;
}
