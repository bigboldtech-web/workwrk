-- 2026-06-03 — Phase 32: Per-Space DataTable scoping.
--   Adds DataTable.spaceId so tables created from inside a Space surface
--   under the right Space chip in /library. Org-wide tables leave it null.
-- Additive-only. Existing rows keep spaceId = null.

ALTER TABLE "DataTable"
    ADD COLUMN "spaceId" TEXT;

CREATE INDEX "DataTable_organizationId_spaceId_idx"
    ON "DataTable"("organizationId", "spaceId");
