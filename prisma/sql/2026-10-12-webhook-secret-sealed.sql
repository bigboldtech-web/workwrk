-- 2026-10-12 Docs-found fixes batch 3: a webhook is signed with the secret
-- its receiver was shown (docs/plans/docs-found-fixes.md, "Batch 3:
-- notifications, API, docs and the browser").
--
-- "WebhookSubscription"."secretSealed" JSONB, nullable: the subscription's
-- secret sealed with SECRETS_ENCRYPTION_KEY (src/lib/connectors/seal.ts lists
-- it in SEALED_COLUMNS, so scripts/rotate-secrets-key.ts moves it with the
-- rest). Deliveries used to be signed with "secretHash", the SHA-256 hex of
-- the secret, while POST /api/webhooks told the receiver to verify with the
-- secret itself, so a receiver that did exactly that rejected every delivery.
--
-- EXISTING ROWS ARE UNCHANGED. The column is nullable with no default:
-- catalogue only. A row made before this file keeps a null here and keeps
-- signing with "secretHash", exactly as it always has, until its secret is
-- rotated (PATCH /api/webhooks), so no receiver that already works breaks.
--
-- CATALOGUE-GUARDED. The ALTER runs only when pg_attribute says the column
-- is missing, so a deploy after the first takes no lock at all. It runs on
-- every deploy (scripts/deploy-migrations.mjs SQL_MANIFEST) under its lock
-- timeout. The table is small (no settings screen makes subscriptions yet).
--
-- NO BACKFILL: the plain secret of an existing row was never stored, so
-- there is nothing to seal.
-- Rollback: ALTER TABLE "WebhookSubscription" DROP COLUMN IF EXISTS "secretSealed";
-- (the code before this file never reads it).

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_attribute
    WHERE attrelid = '"WebhookSubscription"'::regclass AND attname = 'secretSealed' AND NOT attisdropped
  ) THEN
    ALTER TABLE "WebhookSubscription" ADD COLUMN IF NOT EXISTS "secretSealed" JSONB;
  END IF;
END $$;
