-- 2026-06-03 — Phase 20: per-Space file scoping.
--   Adds FileEntry.spaceId so attachments uploaded from inside a
--   Space/Board context can be filtered + restored later. Org-wide
--   uploads leave it null (Library tab without a Space chip).
-- Additive-only. Existing rows keep spaceId = null.

ALTER TABLE "FileEntry"
    ADD COLUMN "spaceId" TEXT;

CREATE INDEX "FileEntry_organizationId_spaceId_idx"
    ON "FileEntry"("organizationId", "spaceId");
