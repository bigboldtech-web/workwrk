-- 2026-06-03 — Phase 18: Space-targeted invitation columns.
--   Adds optional spaceId + spaceRole to Invitation so the accept
--   flow can drop a new user straight into a Space (skipping the
--   KRA/SOP role-definition gate that org-wide hires require).
-- Additive-only. No existing rows touched.

ALTER TABLE "Invitation"
    ADD COLUMN "spaceId" TEXT,
    ADD COLUMN "spaceRole" "SpaceRole";

CREATE INDEX "Invitation_spaceId_idx" ON "Invitation"("spaceId");
