-- 2026-10-20 Validates the CHECK 2026-10-20-browser-host-provider.sql replaced
-- (docs/plans/browser-host.md section 2), in its own transaction: SHARE
-- UPDATE EXCLUSIVE on "TeammateBrowserSession" for the scan, so the session
-- table's reads and writes go on. Every row the old CHECK allowed the new one
-- allows, so the scan cannot fail. Guarded on the CHECK not yet validated: a
-- deploy after the first reads only the catalogue.
--
-- After the file before it; safe before or after the reload. Additive and
-- idempotent. Declared in prisma/schema.prisma by comment only.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'TeammateBrowserSession_values_check'
       AND conrelid = '"TeammateBrowserSession"'::regclass
       AND NOT convalidated
  ) THEN
    ALTER TABLE "TeammateBrowserSession" VALIDATE CONSTRAINT "TeammateBrowserSession_values_check";
  END IF;
END $$;
