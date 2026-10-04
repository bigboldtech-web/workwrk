-- 2026-10-04 - A role on a tool share (batch 7, the one share dialog for
-- tools; spec-tools-misc section 2.1: Can view reads the tool and its login,
-- Can edit changes its fields and its login, Full access also shares and
-- deletes it).
--
-- A share row today is Can view, and a row without a role stays exactly
-- that. The role is read only while ACCESS_V2_TABLES is on
-- (src/lib/tools/tool-access.ts toolShareRole): with the flag off every
-- share reads Can view, as it always has, so turning the flag off leaves
-- each person at Can view and never takes the tool away from anyone.
--
-- ADDITIVE ONLY. One new nullable column on "ToolShare" and its CHECK. No
-- existing column is changed and no existing row is read or written.
--
-- Idempotent: ADD COLUMN IF NOT EXISTS, and the CHECK guarded by a catalogue
-- lookup. Running it twice is a no-op.

ALTER TABLE "ToolShare" ADD COLUMN IF NOT EXISTS "role" TEXT;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'ToolShare_role_check'
  ) THEN
    ALTER TABLE "ToolShare"
      ADD CONSTRAINT "ToolShare_role_check"
      CHECK ("role" IS NULL OR "role" IN ('EDIT', 'FULL'));
  END IF;
END
$$;
