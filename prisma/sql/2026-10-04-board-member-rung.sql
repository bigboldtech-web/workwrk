-- 2026-10-04 - Two more rungs on a List's ladder (founder decision 3,
-- docs/plans/competitor-gap-2026-09.md section 7: "BOTH rungs (edit only
-- assigned rows; comment only)").
--
-- A List member can now be "Can comment" (read and discuss every task, never
-- change one) or "Can edit assigned tasks" (read and discuss every task,
-- change only the tasks assigned to them). Both are stored as the row's
-- existing GUEST role plus this rung, never as a new SpaceRole value: every
-- reader that does not know the rung (the legacy floor, the member routes,
-- raw role reads) keeps reading the row as Can view, so a lowered row can
-- never read as Can edit again. Can view is not the rung, though: it lets an
-- assignee change their task, which Can comment does not, so every reader
-- that decides access loads the rung (src/lib/access/node-world.ts).
--
-- ADDITIVE ONLY. One new nullable column on "BoardMember" and its CHECK. No
-- existing column is changed and no existing row is read or written: a row
-- without a rung is exactly what it was.
--
-- Idempotent: ADD COLUMN IF NOT EXISTS, and the CHECK guarded by a catalogue
-- lookup. Running it twice is a no-op.

ALTER TABLE "BoardMember" ADD COLUMN IF NOT EXISTS "rung" TEXT;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'BoardMember_rung_check'
  ) THEN
    ALTER TABLE "BoardMember"
      ADD CONSTRAINT "BoardMember_rung_check"
      CHECK ("rung" IS NULL OR "rung" IN ('COMMENT', 'ASSIGNED'));
  END IF;
END
$$;
