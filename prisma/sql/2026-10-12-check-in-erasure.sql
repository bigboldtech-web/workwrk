-- 2026-10-12 Docs-found fixes batch 8: an account's erasure deletes the
-- person's check-ins (docs/plans/docs-found-fixes.md, "Batch 8: check-ins
-- follow the membership, and erasure").
--
-- WHY. POST /api/me/delete anonymises the User row and never deletes it, so
-- the foreign key on "CheckIn"."userId" cascades nothing, and neither the
-- erasure nor its sweep touched "CheckIn": an erased person's moods, what
-- went well, challenges and plans stayed, read by their workspace's Admins,
-- People team and org-wide levels under "Deleted User", and the rows naming
-- no workspace stayed for good. The erasure's pass gains the part
-- "checkins", its first (src/lib/agents/erasure-sweep.ts ERASURE_PARTS): one
-- statement that deletes the person's check-ins, of every workspace.
--
-- TWO BLOCKS, EACH CATALOGUE-GUARDED.
--
-- 1. The check-ins of every account already in the erased state, once.
--    Erasures finished before this file are never read by the sweep again,
--    and one under way may already be in its last pass, past the new first
--    part. "The erased state" is src/lib/compliance/erased-account.ts
--    erasedStateSql, word for word (a test holds the two equal): the
--    erasure's provenance record, deletedAt set, and deletedAt within a
--    minute of the newest such record's withdrawnAt. An account an Admin
--    restored, or removed after a restore, is not in it, and keeps its rows.
--    Rows are chosen FOR UPDATE SKIP LOCKED, so the file never waits on a
--    row (one a hard delete's cascade is deleting); the marker (the table's
--    comment, check-in-erasure-2026-10-12) is written only when a plain read
--    after the delete finds none left, else the next deploy deletes the
--    rest. Erasures made after this file, by the build still serving until
--    the reload, are swept by the new build's last pass, which starts from
--    the first part two hours after each erasure.
--
-- 2. The CHECK on "AccountErasure"."part" gains 'checkins', replaced under
--    its own name, guarded on its definition naming 'checkins', as
--    2026-10-11-ai-teammates-phase4-erasure.sql did for 'browser' (that
--    file's guard asks for 'browser', which the new list keeps, and round
--    6's file adds its CHECK only when none of that name exists, so neither
--    brings an old list back). Every row the old list allowed the new one
--    does, so its scan cannot fail. Before the reload: the new build's
--    erasure writes its first part, 'checkins', which the old CHECK refuses.
--
-- LOCKS. Block 1: ROW EXCLUSIVE on "CheckIn" (reads and new check-ins go
-- on), ACCESS SHARE on "User" and "ConsentRecord", and the COMMENT's SHARE
-- UPDATE EXCLUSIVE on "CheckIn". Block 2, last, so it is held for the
-- shortest time: ACCESS EXCLUSIVE on "AccountErasure" for the scan of its
-- rows (one a person who ever erased their account, read only by the
-- erasure and the teammates cron). All under the deploy's 5 s lock_timeout
-- and its retries. A deploy after the first reads only the catalogue.
--
-- PLAN of block 1, as I read it against prisma/schema.prisma: "CheckIn" (a
-- small table) with "User_pkey" per row; the newest erasure record per
-- deleted account by the partial index
-- "ConsentRecord_erasure_userId_createdAt_idx" (method 'erasure', a
-- literal) or "ConsentRecord_userId_idx"; LockRows; the DELETE by
-- "CheckIn_pkey".
--
-- Additive for the schema; the deleted rows are what the erasure promised.
-- Listed in scripts/deploy-migrations.mjs SQL_MANIFEST after the check-in
-- files, before 2026-10-12-check-in-backfill-narrow.sql. Never run here: no
-- SQL was executed, the text is held by tests.
-- Rollback: the build before this never writes 'checkins' and the new CHECK
-- allows all it writes, so nothing needs undoing; the deleted check-ins are
-- in the nightly dump only.

DO $$
BEGIN
  IF COALESCE(obj_description('"CheckIn"'::regclass, 'pg_class'), '') NOT LIKE '%check-in-erasure-2026-10-12%' THEN
    DELETE FROM "CheckIn" c
     USING (
             SELECT ci."id"
               FROM "CheckIn" ci
               JOIN "User" u ON u."id" = ci."userId"
              WHERE (u."deletedAt" IS NOT NULL AND COALESCE((SELECT max(ers."withdrawnAt") FROM "ConsentRecord" ers WHERE ers."userId" = u."id" AND ers."method" = 'erasure' AND ers."withdrawnAt" IS NOT NULL) BETWEEN u."deletedAt" - interval '60000 milliseconds' AND u."deletedAt" + interval '60000 milliseconds', false))
                FOR UPDATE OF ci SKIP LOCKED
           ) gone
     WHERE c."id" = gone."id";
    IF NOT EXISTS (
         SELECT 1
           FROM "CheckIn" ci
           JOIN "User" u ON u."id" = ci."userId"
          WHERE (u."deletedAt" IS NOT NULL AND COALESCE((SELECT max(ers."withdrawnAt") FROM "ConsentRecord" ers WHERE ers."userId" = u."id" AND ers."method" = 'erasure' AND ers."withdrawnAt" IS NOT NULL) BETWEEN u."deletedAt" - interval '60000 milliseconds' AND u."deletedAt" + interval '60000 milliseconds', false))
       ) THEN
      COMMENT ON TABLE "CheckIn" IS
        'Daily check-ins: a person''s own notes. An account''s erasure deletes them (src/lib/agents/erasure-sweep.ts part checkins). check-in-erasure-2026-10-12';
    END IF;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'AccountErasure_values_check'
       AND conrelid = '"AccountErasure"'::regclass
       AND pg_get_constraintdef(oid) LIKE '%''checkins''%'
  ) THEN
    ALTER TABLE "AccountErasure" DROP CONSTRAINT IF EXISTS "AccountErasure_values_check";
    -- The parts of one pass, in order (src/lib/agents/erasure-sweep.ts ERASURE_PARTS).
    ALTER TABLE "AccountErasure" ADD CONSTRAINT "AccountErasure_values_check" CHECK (
      "part" IN ('checkins', 'chats', 'requests', 'browser', 'runs', 'questions', 'activity', 'memories', 'routines')
      AND "tries" >= 0
    );
  END IF;
END $$;
