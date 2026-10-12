-- 2026-10-12 Docs-found fixes batch 7: the older check-ins settled once
-- (docs/plans/docs-found-fixes.md, "Batch 7: check-ins settled once, the
-- last lows").
--
-- WHAT IT DOES. A check-in written before "CheckIn"."organizationId" existed
-- (2026-10-12-check-in-workspace.sql, which is live and is not changed here)
-- names no workspace. Batch 6 decided such a row on every read: others read
-- it where its person held a level in that one workspace alone. That answer
-- could change later (a workspace's hard delete cascades its memberships, so
-- a person's rows written in the deleted workspace became the remaining
-- one's to read), and its Prisma "every" was a NOT IN over every other
-- workspace's memberships on each read. This file asks the same question
-- ONCE: a null row whose person holds a level in exactly one workspace now
-- (anchored there, and no membership in any other) is written as that
-- workspace's. Every other row stays null, and the code reads a null row
-- only for its person (src/lib/check-in-access.server.ts, SETTLED ONCE), so
-- no later deletion can widen who reads it.
--
-- NEVER A GUESS. A person anchored in one workspace with a membership in
-- another keeps their older rows null: the anchor is only the workspace they
-- last switched to. And a row older than the workspace it would go to stays
-- null: it cannot have been written there (it can only be from a workspace
-- that has since been deleted). The one case left: someone whose second
-- workspace was deleted for good before this file ran looks like someone who
-- only ever worked in one, and their rows written there after the remaining
-- one existed are given to the remaining one. Nothing in the database tells
-- the two apart (WorkspaceDeletion keeps no person).
--
-- ONE TIME, BY A MARKER. The marker is the column's comment, set in the same
-- transaction as the UPDATE (as 2026-10-05-membership-admin-scopes.sql
-- does). "Only null rows" is not enough on its own: a row left null today
-- (its person in two workspaces) would be decided again on a later deploy,
-- after one of those workspaces was deleted, which is the widening this
-- file removes. A deploy after the first reads the comment from the
-- catalogue and takes no lock on "CheckIn".
--
-- NO ROW WAIT. The rows are chosen FOR UPDATE SKIP LOCKED, and the workspace
-- each is given FOR KEY SHARE SKIP LOCKED (the key the foreign key check
-- would take), so the file never waits on a row: a check-in being deleted,
-- or a workspace whose hard delete is running (it holds its Organization row
-- FOR UPDATE for up to 30 minutes), is skipped and stays null, which reads
-- as its person's alone. Its table locks: ROW EXCLUSIVE on "CheckIn" (reads
-- and new check-ins go on), ROW SHARE on "Organization", ACCESS SHARE on
-- "User" and "OrganizationMembership", and the COMMENT's SHARE UPDATE
-- EXCLUSIVE on "CheckIn" (it waits only for an autovacuum, which Postgres
-- cancels for it, a manual vacuum or analyze, or an index build, each
-- bounded by the deploy's 5 s lock_timeout and its retries).
--
-- ONE STATEMENT, NOT BATCHED. The null rows are a closed set: every check-in
-- written since the batch 6 build names its workspace (POST writes the
-- session's), and before it nothing in the app wrote "CheckIn" (POST
-- /api/check-ins by hand only; no screen calls it). So the set is what
-- people posted by hand before 2026-10-12. Batching inside this file would
-- not shorten anything: the deploy runs a file as one transaction, so every
-- batch's row locks would be held to the same commit, and a bound per
-- deploy would decide the rest on a later deploy, which the marker exists
-- to prevent. Its cost is one new row version for each row it changes, and
-- an entry in each of "CheckIn"'s four indexes for it (the column is
-- indexed, so no HOT update), all in the WAL once.
--
-- PLAN, as I read it against prisma/schema.prisma: the null rows by
-- "CheckIn_organizationId_createdAt_idx" (a btree holds the nulls) or a scan
-- of the small table; each joined to "User_pkey" and "Organization_pkey";
-- the anti-join by "OrganizationMembership_userId_idx"; LockRows; then the
-- UPDATE by "CheckIn_pkey".
--
-- Safe before or after the reload; it runs before it (scripts/
-- deploy-migrations.mjs SQL_MANIFEST, last).
-- Rollback (by hand, never needed for the code): the rows it wrote are those
-- whose organizationId equals their person's anchor and that were null
-- before; nothing records which, so a rollback is a restore of "CheckIn".

DO $$
BEGIN
  IF COALESCE(col_description('"CheckIn"'::regclass,
       (SELECT attnum FROM pg_attribute
         WHERE attrelid = '"CheckIn"'::regclass AND attname = 'organizationId' AND NOT attisdropped)), '')
     NOT LIKE '%check-in-backfill-2026-10-12%' THEN
    UPDATE "CheckIn" c
       SET "organizationId" = one."organizationId"
      FROM (
             SELECT ci."id", u."organizationId"
               FROM "CheckIn" ci
               JOIN "User" u ON u."id" = ci."userId"
               JOIN "Organization" o ON o."id" = u."organizationId"
              WHERE ci."organizationId" IS NULL
                AND ci."createdAt" >= o."createdAt"
                AND NOT EXISTS (
                      SELECT 1 FROM "OrganizationMembership" m
                       WHERE m."userId" = u."id" AND m."organizationId" <> u."organizationId"
                    )
                FOR UPDATE OF ci SKIP LOCKED
                FOR KEY SHARE OF o SKIP LOCKED
           ) one
     WHERE c."id" = one."id";
    COMMENT ON COLUMN "CheckIn"."organizationId" IS
      'The workspace the check-in was written in. Null: written before check-ins named one and left so by the one-time backfill; read only by its person. check-in-backfill-2026-10-12';
  END IF;
END $$;
