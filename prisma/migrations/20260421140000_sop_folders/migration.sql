-- SOPFolder + SOPFolderAccess + SOP.folderId
--
-- Access-scoping for SOPs. Existing SOPs stay in the "unfoldered"
-- bucket (folderId NULL) and remain visible to everyone, so nothing
-- regresses for orgs that haven't organized into folders yet.

CREATE TABLE IF NOT EXISTS "SOPFolder" (
  "id"             TEXT PRIMARY KEY,
  "name"           TEXT NOT NULL,
  "color"          TEXT,
  "description"    TEXT,
  "organizationId" TEXT NOT NULL,
  "createdAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"      TIMESTAMP(3) NOT NULL,
  CONSTRAINT "SOPFolder_organizationId_fkey"
    FOREIGN KEY ("organizationId") REFERENCES "Organization"("id")
    ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX IF NOT EXISTS "SOPFolder_organizationId_name_key"
  ON "SOPFolder"("organizationId", "name");
CREATE INDEX IF NOT EXISTS "SOPFolder_organizationId_idx"
  ON "SOPFolder"("organizationId");

CREATE TABLE IF NOT EXISTS "SOPFolderAccess" (
  "folderId"  TEXT NOT NULL,
  "userId"    TEXT NOT NULL,
  "grantedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY ("folderId", "userId"),
  CONSTRAINT "SOPFolderAccess_folderId_fkey"
    FOREIGN KEY ("folderId") REFERENCES "SOPFolder"("id")
    ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "SOPFolderAccess_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "User"("id")
    ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX IF NOT EXISTS "SOPFolderAccess_userId_idx"
  ON "SOPFolderAccess"("userId");

ALTER TABLE "SOP"
  ADD COLUMN IF NOT EXISTS "folderId" TEXT;

ALTER TABLE "SOP"
  ADD CONSTRAINT "SOP_folderId_fkey"
    FOREIGN KEY ("folderId") REFERENCES "SOPFolder"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;

CREATE INDEX IF NOT EXISTS "SOP_folderId_idx" ON "SOP"("folderId");
