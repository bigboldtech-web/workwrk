-- Policy acknowledgement evidence: version-pinned, hashed, attested acks +
-- the ackVersion baseline that the per-publish "require re-acknowledgement"
-- toggle drives. Additive + backfilled so existing acks stay valid.

-- 1. Policy: ackVersion baseline + optional custom attestation statement.
ALTER TABLE "Policy" ADD COLUMN "ackVersion" INTEGER NOT NULL DEFAULT 1;
ALTER TABLE "Policy" ADD COLUMN "ackStatement" TEXT;

-- 2. PolicyAcknowledgment: evidence columns.
ALTER TABLE "PolicyAcknowledgment" ADD COLUMN "version" INTEGER;
ALTER TABLE "PolicyAcknowledgment" ADD COLUMN "policyVersionId" TEXT;
ALTER TABLE "PolicyAcknowledgment" ADD COLUMN "userAgent" TEXT;
ALTER TABLE "PolicyAcknowledgment" ADD COLUMN "contentHash" TEXT;
ALTER TABLE "PolicyAcknowledgment" ADD COLUMN "attestation" TEXT;

-- 3. Backfill: existing acks count as acknowledging the policy's current version,
--    and the ackVersion baseline equals the current version (so prior acks stay valid).
UPDATE "PolicyAcknowledgment" a
  SET "version" = p."version"
  FROM "Policy" p
  WHERE a."policyId" = p."id" AND a."version" IS NULL;

UPDATE "Policy" SET "ackVersion" = "version";

-- 4. Swap the uniqueness from (policyId,userId) to (policyId,userId,version).
DROP INDEX IF EXISTS "PolicyAcknowledgment_policyId_userId_key";
CREATE UNIQUE INDEX "PolicyAcknowledgment_policyId_userId_version_key"
  ON "PolicyAcknowledgment" ("policyId", "userId", "version");
