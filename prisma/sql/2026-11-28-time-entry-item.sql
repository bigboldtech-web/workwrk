/* 2026-11-28 TimeEntry."itemId", the link from a time entry to its task
   (pen test 2026-11-28, V-48).

   WHAT THIS FILE DOES, each step guarded, so a deploy that finds them all
   in place changes nothing:
   1. The column "itemId" (text, may be empty), if missing.
   2. Its index "TimeEntry_itemId_idx", if missing.
   3. Its key to "Item" ("TimeEntry_itemId_fkey", on delete set null, on
      update cascade), if missing, added NOT VALID: no existing row is read,
      changed or deleted to add it; new and changed rows are held to it.
   Nothing is deleted and no row is written.

   WHY. The column came in with the timer-to-timesheet bridge (fa098738),
   applied by hand ("prod pending"), and no file in prisma/migrations or in
   the deploy manifest ever created it; it is in the schema baseline as a
   column production carries. Every read of TimeEntry selects it, so a
   database without it answers 500 on GET /api/time/active and on a
   timesheet, and the timer's hours never reach the week. This file makes
   that true by construction: on a database that has it, nothing happens. */

ALTER TABLE "TimeEntry" ADD COLUMN IF NOT EXISTS "itemId" TEXT;

CREATE INDEX IF NOT EXISTS "TimeEntry_itemId_idx" ON "TimeEntry"("itemId");

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'TimeEntry_itemId_fkey' AND conrelid = '"TimeEntry"'::regclass
  ) THEN
    ALTER TABLE "TimeEntry"
      ADD CONSTRAINT "TimeEntry_itemId_fkey" FOREIGN KEY ("itemId")
      REFERENCES "Item"("id") ON DELETE SET NULL ON UPDATE CASCADE NOT VALID;
  END IF;
END $$;
