/* 2026-10-27 Recurring goals, the KPI a period reads (docs/plans/recurring-goals.md
   C6, B7; step 2 review M6). Two new nullable columns on "KeyResultPeriod":
   "kpiId" and "kpiUserId", the KPI and the person a KPI-linked target's row
   reads, fixed when the period opens. The close and every read of the
   period use them, never today's goal owner or KPI link, so reassigning the
   goal or unlinking the KPI while October waits for its KPI numbers leaves
   October alone; a change reaches the period running now only.
   Bare ids, NO KEY to "KPI" or "User", so no lock on either.
   Additive and idempotent.
   EXISTING ROWS ARE UNCHANGED: a row opened before this file reads as a
   hand-checked row (both columns NULL). NO BACKFILL: production has no
   period rows yet (RECURRING_GOALS is off).
   APPLY THIS FILE BEFORE THE CODE: the new client selects every scalar of
   "KeyResultPeriod" on a findUnique with no select, and the opening writes
   both columns.
   CATALOGUE-GUARDED. Each column is added only when pg_attribute says it is
   missing, so a deploy after the first takes no lock. The first apply takes
   ACCESS EXCLUSIVE on "KeyResultPeriod" for a moment (a new, small table;
   NULL columns, no rewrite).
   Rollback: ALTER TABLE "KeyResultPeriod" DROP COLUMN IF EXISTS "kpiId", DROP COLUMN IF EXISTS "kpiUserId"; */

DO $$
BEGIN
  /* The KPI this row reads for its period, or NULL for a hand-checked row. */
  IF NOT EXISTS (SELECT 1 FROM pg_attribute WHERE attrelid = '"KeyResultPeriod"'::regclass AND attname = 'kpiId' AND NOT attisdropped) THEN
    ALTER TABLE "KeyResultPeriod" ADD COLUMN IF NOT EXISTS "kpiId" TEXT;
  END IF;
  /* The person whose KPI records it reads (the goal's owner at opening), or NULL for an ownerless goal. */
  IF NOT EXISTS (SELECT 1 FROM pg_attribute WHERE attrelid = '"KeyResultPeriod"'::regclass AND attname = 'kpiUserId' AND NOT attisdropped) THEN
    ALTER TABLE "KeyResultPeriod" ADD COLUMN IF NOT EXISTS "kpiUserId" TEXT;
  END IF;
END
$$;
