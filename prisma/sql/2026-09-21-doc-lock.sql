-- Phase 3 (docs-knowledge), spec-docs-knowledge section 4 "Data migrations":
--   Doc.lockedById / Doc.lockedAt  (change request A4, "Lock page")
--   Template.usedCount             (already in the schema; ensured here so a
--                                   database that predates the column gets it)
-- Additive and idempotent. Nothing is renamed, retyped, dropped or required.

ALTER TABLE "Doc" ADD COLUMN IF NOT EXISTS "lockedById" TEXT;
ALTER TABLE "Doc" ADD COLUMN IF NOT EXISTS "lockedAt" TIMESTAMP(3);

ALTER TABLE "Template" ADD COLUMN IF NOT EXISTS "usedCount" INTEGER NOT NULL DEFAULT 0;
