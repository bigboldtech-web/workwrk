/* 2026-10-27 Item completions (docs/plans/recurring-goals.md C4, step 4). One
   new append-only table, "ItemCompletion": a row each time a task enters
   its List's done group (the done status it entered, when, who), so a goal
   counted "by Done date" reads real completion times: a task done four
   times counts four times, and a reorder (which rewrites "Item"."updatedAt")
   moves nothing. Nothing on "Item": NO KEY to "Item", so no lock on it,
   ever; the nightly repair deletes rows whose task is gone.
   Additive and idempotent. EXISTING ROWS ELSEWHERE ARE UNCHANGED.
   NO BACKFILL IN THE DEPLOY: the one-time backfill is
   scripts/backfill-item-completions.ts (dry run by default), run by the
   founder once, NOT part of the deploy.
   APPLY THIS FILE BEFORE THE CODE: every status write path inserts into it
   in the same transaction as the status.
   CATALOGUE-GUARDED. The indexes are built only when pg_indexes says they
   are missing, on the new, empty table, so a deploy after the first takes
   no lock.
   Rollback: DROP TABLE IF EXISTS "ItemCompletion"; */

CREATE TABLE IF NOT EXISTS "ItemCompletion" (
  "id"             TEXT NOT NULL,
  "itemId"         TEXT NOT NULL,
  "boardId"        TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "status"         TEXT NOT NULL,
  "doneAt"         TIMESTAMP(3) NOT NULL,
  "actorId"        TEXT,
  CONSTRAINT "ItemCompletion_pkey" PRIMARY KEY ("id")
);

DO $$
BEGIN
  /* A goal's Done date window over a workspace, and the nightly repair's reads. */
  IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE schemaname = current_schema() AND indexname = 'ItemCompletion_organizationId_doneAt_idx') THEN
    CREATE INDEX "ItemCompletion_organizationId_doneAt_idx" ON "ItemCompletion" ("organizationId", "doneAt");
  END IF;
  /* One task's completions: the latest one a reopen removes, a duplicate copies. */
  IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE schemaname = current_schema() AND indexname = 'ItemCompletion_itemId_doneAt_idx') THEN
    CREATE INDEX "ItemCompletion_itemId_doneAt_idx" ON "ItemCompletion" ("itemId", "doneAt");
  END IF;
  /* A goal's Done date window over its Lists. */
  IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE schemaname = current_schema() AND indexname = 'ItemCompletion_boardId_doneAt_idx') THEN
    CREATE INDEX "ItemCompletion_boardId_doneAt_idx" ON "ItemCompletion" ("boardId", "doneAt");
  END IF;
END
$$;
