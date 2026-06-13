-- SOP author/publisher governance + folder roles (Phase 3).
-- ADDITIVE ONLY: a new enum, two nullable columns, a defaulted column,
-- one index and a nullable FK. No DROP / DELETE / TRUNCATE — existing
-- SOPs and all other data are untouched.
CREATE TYPE "SOPFolderRole" AS ENUM ('VIEWER', 'EDITOR', 'OWNER');

ALTER TABLE "SOP" ADD COLUMN "createdById" TEXT;
ALTER TABLE "SOP" ADD COLUMN "publishedBy" TEXT;

ALTER TABLE "SOPFolderAccess" ADD COLUMN "role" "SOPFolderRole" NOT NULL DEFAULT 'EDITOR';

CREATE INDEX "SOP_createdById_idx" ON "SOP"("createdById");

ALTER TABLE "SOP" ADD CONSTRAINT "SOP_createdById_fkey"
  FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
