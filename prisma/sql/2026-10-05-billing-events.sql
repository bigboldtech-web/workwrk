-- Batch 13: Stripe events applied in order, and a deleted workspace's
-- billing ids kept.
--
-- "stripeEventAt" on "Subscription": the time of the Stripe event last
-- applied (src/services/billing.ts applySubscriptionEvent). Stripe delivers
-- events out of order and retries them for days, so an older event that
-- arrives after a newer one (an "updated" after the "deleted") is skipped
-- instead of turning a cancelled subscription live again.
--
-- "stripeCustomerId" and "stripeSubscriptionId" on "WorkspaceDeletion": the
-- Subscription row goes with the company at the hard delete, and with it the
-- only link to the customer in Stripe (refunds, disputes, a charge to
-- explain). The deletion record keeps both.
--
-- Additive and idempotent: three nullable columns, no backfill. It runs on
-- every deploy (manifest in scripts/deploy-migrations.mjs), under its lock
-- timeout.

ALTER TABLE "Subscription" ADD COLUMN IF NOT EXISTS "stripeEventAt" TIMESTAMP(3);
ALTER TABLE "WorkspaceDeletion" ADD COLUMN IF NOT EXISTS "stripeCustomerId" TEXT;
ALTER TABLE "WorkspaceDeletion" ADD COLUMN IF NOT EXISTS "stripeSubscriptionId" TEXT;
