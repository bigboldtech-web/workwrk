// Whether Stripe billing is configured (STRIPE_SECRET_KEY set): the one rule
// src/services/billing.ts (isBillingLive) and the boot payload share. Kept
// free of the Stripe SDK, so the boot route does not load it.
export function billingConfigured(): boolean {
  return Boolean(process.env.STRIPE_SECRET_KEY);
}
