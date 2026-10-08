-- AI teammates, Phase 3, review of step 2 (docs/plans/ai-teammates-phase3.md,
-- "After Phase 3"): a queued revoke never ends a reconnect.
--
-- Google revokes a whole grant per client and account, so a revoke queued
-- when someone disconnected, and sent after they connected the same Google
-- account again (here or in another workspace), ended the new connection
-- too. Each queue row now keeps its account as "accountKey": the sha256 hex
-- of provider, ':' and the account's sub. It names no person and no
-- workspace. Just before telling Google, the queue deletes unsent a row whose
-- key a live connection holds (src/lib/connectors/connections.ts
-- dropStillHeld), under the same per-account lock every path that decides a
-- revoke takes. "TeammateConnection" keeps the same key, indexed, so that
-- check is one index read rather than a hash of every connection.
--
-- Additive and idempotent: two nullable columns (ADD COLUMN IF NOT EXISTS, a
-- catalogue change, no row rewritten), one index IF NOT EXISTS, and a
-- backfill of the connections that have no key yet, guarded on its own
-- effect, so a second run changes nothing. A queue row written before this
-- (key NULL) is revoked as before. The phase3 file is not changed: it ran in
-- production already.
-- Rollback: DROP INDEX IF EXISTS "TeammateConnection_accountKey_idx";
--   ALTER TABLE "TeammateConnection" DROP COLUMN IF EXISTS "accountKey";
--   ALTER TABLE "TeammateTokenRevocation" DROP COLUMN IF EXISTS "accountKey";

ALTER TABLE "TeammateTokenRevocation" ADD COLUMN IF NOT EXISTS "accountKey" TEXT;

ALTER TABLE "TeammateConnection" ADD COLUMN IF NOT EXISTS "accountKey" TEXT;

CREATE INDEX IF NOT EXISTS "TeammateConnection_accountKey_idx" ON "TeammateConnection" ("accountKey");

UPDATE "TeammateConnection"
   SET "accountKey" = encode(sha256(convert_to("provider" || ':' || "accountSub", 'UTF8')), 'hex')
 WHERE "accountKey" IS NULL;
