-- 2026-10-12 Docs-found fixes batch 8: the backfill of the older check-ins,
-- narrowed (docs/plans/docs-found-fixes.md, "Batch 8: check-ins follow the
-- membership, and erasure").
--
-- WHY. prisma/sql/2026-10-12-check-in-backfill.sql (live, and never changed:
-- its marker means it runs once) gave a check-in that named no workspace to
-- its person's anchor when they held no membership in any other workspace,
-- reading that as "only ever worked in one". That is not sure for a person
-- who reached their anchor through a membership: moves made with the switcher
-- before reanchorUser kept no membership for the workspace left
-- (src/lib/access/workspace-anchor.ts). Sam signed up in Acme after
-- 2026-05-16 (so no primary membership), accepted an invite to Globex (a
-- membership there) and switched to Globex: his only membership is Globex's,
-- so his hand-posted Acme check-ins went to Globex, whose Admins, People team
-- and org-wide levels read them. Leaving a row null costs nothing (no screen
-- shows check-ins; the person still reads it), so this only ever narrows.
--
-- WHAT IT SETS BACK TO NULL, once (both read as "its person's alone",
-- src/lib/check-in-access.server.ts):
--
--   (1) A row created before 2026-10-12T10:00:00Z naming a workspace in
--       which its person holds a NON-PRIMARY membership. The bound: every
--       row the backfill could give a workspace was written before the
--       batch 6 build (749b7435, committed 09:08Z, live before 10:00Z),
--       which writes the column on every POST. That is someone who reached
--       the workspace through a
--       membership. A person's workspace with no membership row at all, or
--       with their primary one, is where their account began: every
--       account from before 2026-05-16 has its home as its primary
--       membership (20260516130000_add_organization_membership), an account
--       made since begins anchored with no membership (signup, a new
--       account's invitation, SCIM), and every move needs a membership in
--       the workspace moved to (the switcher lists memberships only; the
--       sign-in fallback and the hard delete's moveHomesOutOf choose from
--       them), which organizations/create and an existing account's
--       invitation write non-primary. reanchorUser writes the workspace
--       left as primary only when there is no primary yet, which is only
--       ever the account's first home. Read by the row's workspace, not by
--       today's anchor, so a move since the backfill changes nothing. A row
--       POST wrote before 10:00Z in a workspace reached through a
--       membership becomes its person's alone too, which is safe.
--
--   (2) Any row naming a workspace its person holds no level in now (not
--       anchored there, no membership there). SCIM's new end of a
--       membership (scim-deprovision.ts, in the 8e3f75af build) deleted a
--       membership and left that person's check-ins of the workspace
--       readable there; batch 8 nulls them in the same transaction from
--       now on, and this settles the ones written before. A removed account
--       (deletedAt) is still anchored, so its rows stay. A row the
--       hard delete of its workspace takes is gone with it (the foreign key
--       cascades).
--
-- NEVER WIDER. Every write is organizationId = NULL, which no reader but
-- the person reads; nothing is ever given a workspace. The one case the
-- backfill's header calls left (a person whose second workspace was deleted
-- for good before it ran) is not told apart here either: nothing in the
-- database records it.
--
-- ONCE, BY ITS OWN MARKER, AND ONLY WHEN NOTHING IS LEFT. The marker is the
-- column's comment again, and the new comment keeps the backfill's marker
-- (check-in-backfill-2026-10-12), so the backfill, which runs before this
-- on every deploy and reads only that text, never runs again. The rows are
-- chosen FOR UPDATE SKIP LOCKED, as the backfill's are, so the file never
-- waits on a row; but a skipped row would stay as wide as it is, so the
-- marker is written only when a plain read after the UPDATE finds no row
-- left to narrow. Otherwise the next deploy runs it again, which can only
-- narrow. The rows that can be locked are being deleted (a hard delete's
-- cascade), or nulled by SCIM.
--
-- LOCKS. ROW EXCLUSIVE on "CheckIn" (reads and new check-ins go on), ACCESS
-- SHARE on "User" and "OrganizationMembership", no lock on "Organization"
-- (a null needs no foreign key check), and the COMMENT's SHARE UPDATE
-- EXCLUSIVE on "CheckIn" (it waits only for an autovacuum, which Postgres
-- cancels for it, a manual vacuum or analyze, or an index build, each
-- bounded by the deploy's 5 s lock_timeout and its retries).
--
-- PLAN, as I read it against prisma/schema.prisma: the rows naming a
-- workspace by "CheckIn_organizationId_createdAt_idx" (or a scan of the
-- small table); "User_pkey" per row; each EXISTS by
-- "OrganizationMembership_userId_organizationId_key" (userId and
-- organizationId both given); LockRows; the UPDATE by "CheckIn_pkey". The
-- read before the marker is the same, without LockRows.
--
-- After 2026-10-12-check-in-backfill.sql (listed last in scripts/
-- deploy-migrations.mjs SQL_MANIFEST). Safe before or after the reload.
-- Never run here: no SQL was executed, the text is held by a test.
-- Rollback (by hand, never needed for the code): nothing records which rows
-- it nulled, so a rollback is a restore of "CheckIn".

DO $$
BEGIN
  IF COALESCE(col_description('"CheckIn"'::regclass,
       (SELECT attnum FROM pg_attribute
         WHERE attrelid = '"CheckIn"'::regclass AND attname = 'organizationId' AND NOT attisdropped)), '')
     NOT LIKE '%check-in-backfill-narrow-2026-10-12%' THEN
    UPDATE "CheckIn" c
       SET "organizationId" = NULL
      FROM (
             SELECT ci."id"
               FROM "CheckIn" ci
               JOIN "User" u ON u."id" = ci."userId"
              WHERE ci."organizationId" IS NOT NULL
                AND (
                      (ci."createdAt" < (TIMESTAMPTZ '2026-10-12 10:00:00+00' AT TIME ZONE 'UTC')
                       AND EXISTS (
                             SELECT 1 FROM "OrganizationMembership" m
                              WHERE m."userId" = ci."userId" AND m."organizationId" = ci."organizationId" AND NOT m."isPrimary"
                           ))
                      OR (u."organizationId" <> ci."organizationId"
                          AND NOT EXISTS (
                                SELECT 1 FROM "OrganizationMembership" m
                                 WHERE m."userId" = ci."userId" AND m."organizationId" = ci."organizationId"
                              ))
                    )
                FOR UPDATE OF ci SKIP LOCKED
           ) one
     WHERE c."id" = one."id";
    IF NOT EXISTS (
         SELECT 1
           FROM "CheckIn" ci
           JOIN "User" u ON u."id" = ci."userId"
          WHERE ci."organizationId" IS NOT NULL
            AND (
                  (ci."createdAt" < (TIMESTAMPTZ '2026-10-12 10:00:00+00' AT TIME ZONE 'UTC')
                   AND EXISTS (
                         SELECT 1 FROM "OrganizationMembership" m
                          WHERE m."userId" = ci."userId" AND m."organizationId" = ci."organizationId" AND NOT m."isPrimary"
                       ))
                  OR (u."organizationId" <> ci."organizationId"
                      AND NOT EXISTS (
                            SELECT 1 FROM "OrganizationMembership" m
                             WHERE m."userId" = ci."userId" AND m."organizationId" = ci."organizationId"
                          ))
                )
       ) THEN
      COMMENT ON COLUMN "CheckIn"."organizationId" IS
        'The workspace the check-in was written in. Null: written before check-ins named one and left so by the one-time backfill, or its person''s alone since (the narrowing, the end of a membership); read only by its person. check-in-backfill-2026-10-12 check-in-backfill-narrow-2026-10-12';
    END IF;
  END IF;
END $$;
