// Lazy singleton for Stripe.js. The publishable key is a public value baked into
// the client bundle (safe to expose) and read from NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY.
// `loadStripe` injects the Stripe.js script on first call, so we defer it until a
// top-up actually starts and reuse the same promise thereafter.

import { loadStripe, type Stripe } from "@stripe/stripe-js";

/** The publishable key, or `undefined` when Stripe isn't configured for this env. */
export function stripePublishableKey(): string | undefined {
  return process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY || undefined;
}

/** Whether a publishable key is configured (top-up is disabled without one). */
export function isStripeConfigured(): boolean {
  return Boolean(stripePublishableKey());
}

let stripePromise: Promise<Stripe | null> | null = null;

/**
 * Resolve the shared Stripe.js instance, loading it on first use. Returns `null`
 * when no publishable key is configured so callers can degrade gracefully.
 */
export function getStripe(): Promise<Stripe | null> {
  const key = stripePublishableKey();
  if (!key) return Promise.resolve(null);
  if (!stripePromise) stripePromise = loadStripe(key);
  return stripePromise;
}
