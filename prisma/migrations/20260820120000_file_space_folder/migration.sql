-- Files inside Space folders. Additive + idempotent: FileEntry gains an
-- optional anchor to the Space-hierarchy Folder, so a file can live in any
-- folder in Spaces AND surface in the Library drive.
ALTER TABLE "FileEntry" ADD COLUMN IF NOT EXISTS "spaceFolderId" TEXT;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'FileEntry_spaceFolderId_fkey') THEN
    ALTER TABLE "FileEntry" ADD CONSTRAINT "FileEntry_spaceFolderId_fkey"
      FOREIGN KEY ("spaceFolderId") REFERENCES "Folder"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS "FileEntry_organizationId_spaceFolderId_idx"
  ON "FileEntry"("organizationId", "spaceFolderId");
