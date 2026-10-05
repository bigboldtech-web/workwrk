-- Batch 12: email retries back off, and a claim is a lease.
--
-- "nextAttemptAt" on "EmailLog": for a QUEUED row, when its next try is due
-- (src/lib/email.ts retries over about eight hours instead of three quick
-- tries); for a SENDING row, when the claim of the run sending it runs out,
-- so a row whose run died (a deploy's reload, a crash) is taken again.
--
-- Additive and idempotent: one nullable column, no backfill (NULL reads as
-- "due now" for QUEUED rows and "claimed at createdAt" for old SENDING rows,
-- which is what the code expects). It runs on every deploy (manifest in
-- scripts/deploy-migrations.mjs), under its lock timeout.

ALTER TABLE "EmailLog" ADD COLUMN IF NOT EXISTS "nextAttemptAt" TIMESTAMP(3);
