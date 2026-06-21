import { loadStripe, type Stripe } from '@stripe/stripe-js';

// Publishable (test) key — safe to expose. Card features are disabled if it's unset.
const key = import.meta.env.VITE_STRIPE_PUBLISHABLE_KEY as string | undefined;

export const stripeConfigured = !!key;
export const stripePromise: Promise<Stripe | null> | null = key ? loadStripe(key) : null;
