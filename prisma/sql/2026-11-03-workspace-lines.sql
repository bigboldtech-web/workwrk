/* 2026-11-03 A person's manager and dotted lines in each workspace
   (docs/plans/workspace-status-2.md, decisions E1, E2 and E11, step 1).
   WHAT THIS FILE DOES, in order:
   1. adds "OrganizationMembership"."managerId" (TEXT, nullable) and
      "UserDottedLine"."organizationId" (TEXT, nullable until step 2 sets it
      NOT NULL), and three indexes: "OrganizationMembership_managerId_organizationId_idx",
      "UserDottedLine_organizationId_managerId_idx" and
      "UserDottedLine_organizationId_userId_idx"; every one catalogue-guarded,
      on every deploy;
   2. ONE-TIME, marker workspace-lines-2026-11-03 on the comment of
      "OrganizationMembership"."managerId", one DO statement, in this order:
      (i) the membership lines copied; (ii) the account lines no workspace
      reads cleared, each with its audit row; the old dotted unique
      dropped; (iii) each dotted line given its workspace, a copy inserted
      for each other workspace that reads it, and a line no workspace reads
      removed, each with its audit row; "UserDottedLine"."organizationId"
      set NOT NULL; the new dotted unique;
   3. the two keys, last, added NOT VALID and then validated, each
      catalogue-guarded: "OrganizationMembership"."managerId" to "User"
      (ON DELETE SET NULL, as User's own line) and
      "UserDottedLine"."organizationId" to "Organization" (ON DELETE CASCADE).
   The one-time step writes its marker in the same statement, with the
   moment it ran ("applied ... UTC": T0, where the window check below
   starts), so it never runs half and never runs twice; and it runs only
   while "UserDottedLine"."organizationId" is still nullable, a second guard
   only this step changes (the step 1 review L2). It deletes nothing but the dotted lines
   no workspace reads, and each one leaves an Audit row that carries it.

   WHY. A person has one account row ("User"), anchored to one workspace,
   and a membership row for every other workspace they belong to. Phase 1
   (2026-11-01-membership-status.sql) gave each membership the person's
   status and profile in that workspace. The manager line stayed one per
   account: "User"."managerId" and every "UserDottedLine" row were read by
   every workspace the person belongs to, so B setting Pat's Reports to
   changed it in A too, and A's trees, reach, digests, reviewers and
   approvers followed B's choice. Now "User"."managerId" means the manager
   in the workspace the account is anchored to, each membership holds the
   manager in its own workspace (a move swaps them, as it swaps the level:
   src/lib/access/workspace-anchor.ts reanchorUser), and each dotted line
   names the workspace it belongs to.

   THE MEMBERSHIP LINES, (i). Every membership row of a workspace W other
   than the account's anchor gets "managerId" = "User"."managerId", where
   that manager holds a row in W (anchored in W, or a membership row for
   W) in ANY state, and is not the person. A line to someone W deactivated
   or removed is copied too: it is shown nowhere, and comes back with a
   restore only under the restore's own check of stale lines, as today.
   The anchored workspace's own stale membership row is never written: no
   reader takes the anchored line from it.

   THE ACCOUNT LINES, (ii). "User"."managerId" is cleared where the manager
   holds NO row in the anchored workspace. Such a line was carried in by a
   move from the workspace where it belonged, and (i) has copied it there.
   Left on the account, it would wake up the day that manager joins the
   anchored workspace, and hand them this person's record, reviews and
   KPIs there: reach that workspace never gave. Its old value is kept in
   an "ActivityLog" row in the anchored workspace, in the same statement:
   type reporting_line_changed, actor the system (no person), target the
   person, the manager's id in oldValue, a description naming nobody, its
   id "deploy-line-cleared-" and the person's id.

   THE DOTTED LINES, (iii). A line belongs to each workspace where both the
   person and the manager hold a row (any state). The existing row takes
   the person's anchored workspace when it qualifies, otherwise the first
   qualifying one by id; a copy is inserted for each other one (its id
   "deploy-dotted-", the row's id, "-" and the workspace's id; the note,
   the weight, the dates and createdAt copied). A line that qualifies
   nowhere is removed, with an "ActivityLog" row in the person's anchored
   workspace carrying it, in the same statement: type
   reporting_line_changed, actor the system, target the person, metadata
   with the manager's id, the note, the weight, both dates and createdAt,
   its id "deploy-dotted-removed-" and the line's id. The old unique
   ("userId", "managerId") is dropped before the copies, and the new one
   ("userId", "managerId", "organizationId") is built after NOT NULL.

   NOBODY'S MANAGER CHANGES ON THE DEPLOY in any workspace that reads it
   (E11 iv): each workspace keeps exactly the line it showed and walked,
   since the copy covers every workspace where the manager has a row and
   the readers' seat filters are unchanged. Only lines no workspace read
   leave their columns, each with its record.

   CATALOGUE-GUARDED. Each column, index and key is added only when the
   catalogue says it is missing, so a deploy after the first reads only
   the catalogue and takes no lock. The first apply takes ACCESS EXCLUSIVE
   on "OrganizationMembership" and on "UserDottedLine" (NULL columns, no
   rewrite) and holds them to the end: the deploy runs a file as one
   transaction. THE KEYS COME LAST, added NOT VALID and then validated in
   the same transaction: a key takes SHARE ROW EXCLUSIVE on the table it
   names ("User", "Organization"), which holds off their writes (never
   their reads), and holds it to the commit whether or not it is added NOT
   VALID, so what keeps it short is its place (the step 1 review L1): taken
   after the one-time step, it is held only for the validation scans of the
   two tables and the commit. A line copied from a manager
   deleted meanwhile fails the validation, which rolls the whole file back
   with nothing half done, and the deploy tries again. A deadlock with the
   app (the step writes "User" rows while it holds "OrganizationMembership")
   is tried again the same way (scripts/deploy-migrations.mjs).

   APPLY THIS FILE BEFORE THE CODE: the new client selects
   "OrganizationMembership"."managerId" on every read of a membership with
   no select and "UserDottedLine"."organizationId" on every dotted line,
   and writes both.

   THE ONE-TIME MARKER LIVES IN THE COMMENT ON "OrganizationMembership"."managerId".
   A later file that runs COMMENT ON COLUMN "OrganizationMembership"."managerId"
   MUST KEEP the text workspace-lines-2026-11-03 in it, and the "applied ...
   UTC" after it while the window check may still be run. Without the
   marker the step would not run again only because the dotted column is
   NOT NULL by then (the second guard).

   WHY THE DATA STEP IS HERE AND NOT IN scripts/ (prisma/sql/README.md asks
   this argument of any data rewrite in this folder). It has to be atomic
   with the columns: from the moment the new release reads a membership's
   line, a membership left at NULL shows a person who reported to Max in B
   with no manager there, and their reviews, digests and approvals go to
   nobody; and a dotted line with no workspace is read by none.

   THE WINDOW: FROM THIS FILE TO THE NEW RELEASE'S FIRST REQUEST (the step 1
   review H1). The deploy runs this file, then unpacks, swaps and reloads;
   until the reload the release before this one serves on the new data,
   and it writes no membership line and reads only the account's. So in
   those minutes:
   - every move it makes writes no line: the switcher, an end that moves
     the account (D3), a restore that moves it (D6), the sign-in and
     session repair (D7), an invitation joined with an existing account,
     and the hard delete's move home. The membership left keeps a NULL
     line, so that workspace loses its line; the account keeps the line of
     the workspace it left as its new workspace's, so the line (i) copied
     there is no longer read, and a manager with no row there is carried in
     (the line (ii) exists to clear);
   - its handover (a manager deactivated or removed) plans from and moves
     account lines only, so a membership line naming the leaver stays, and
     after the reload that person reports to someone that workspace ended;
   - a membership it makes gets no copy of the account's line;
   - someone working somewhere through a membership whose account line (ii)
     cleared shows no manager there, and a line read in two workspaces is
     two rows to its reads by person (a dotted manager shown twice);
   - a dotted-line save that adds a line fails with "Something went wrong"
     (its upsert names the old unique, and its row has no workspace), with
     nothing written; one that only takes lines off, and its clears on a
     restore or a reactivation, delete by person and manager under its old
     rule, which keeps a line another workspace relies on but may also take
     off a copy where that manager is deactivated or an Agent.
   No line it loses or carries leaves a record. RIGHT AFTER EVERY DEPLOY OF THIS RELEASE, run
   prisma/sql/after-deploy/2026-11-03-workspace-lines-window-check.sql
   (read-only), and when it lists anything,
   prisma/sql/after-deploy/2026-11-03-workspace-lines-window-recovery.sql:
   it puts back each move's lines from what the rows still hold, never over
   a line the new release wrote, each with its Audit row; the rest is set by
   hand. T0 is in this column's comment; T1 (the reload) is taken from the
   deploy log. A DEPLOY THAT STOPS AFTER THIS FILE (the unpack, the checksum,
   the swap or the new release's check failed, and the build before it is
   put back) leaves the release before this one serving on the new data, and
   every move until the next deploy loses a line: redeploy at once, then run
   the check and the recovery.

   Rollback: put the account lines back from their audit rows, UPDATE "User" u SET "managerId" = a."oldValue" ->> 'managerId' FROM "ActivityLog" a WHERE a."id" = 'deploy-line-cleared-' || u."id" AND u."managerId" IS NULL AND EXISTS (SELECT 1 FROM "User" x WHERE x."id" = a."oldValue" ->> 'managerId'); delete the dotted copies, DELETE FROM "UserDottedLine" WHERE "id" LIKE 'deploy-dotted-%'; re-insert the removed rows from their audit rows, INSERT INTO "UserDottedLine" ("id", "userId", "managerId", "organizationId", "role", "weight", "startDate", "endDate", "createdAt", "updatedAt") SELECT substr(a."id", 23), a."targetId", a."metadata" ->> 'managerId', a."organizationId", a."metadata" ->> 'note', (a."metadata" ->> 'weight')::double precision, (a."metadata" ->> 'startDate')::timestamp(3), (a."metadata" ->> 'endDate')::timestamp(3), (a."metadata" ->> 'createdAt')::timestamp(3), (now() AT TIME ZONE 'UTC') FROM "ActivityLog" a WHERE a."id" LIKE 'deploy-dotted-removed-%' AND EXISTS (SELECT 1 FROM "User" x WHERE x."id" = a."targetId") AND EXISTS (SELECT 1 FROM "User" y WHERE y."id" = a."metadata" ->> 'managerId') ON CONFLICT DO NOTHING; delete the audit rows these consumed, so a later apply writes its own, DELETE FROM "ActivityLog" WHERE "id" LIKE 'deploy-line-cleared-%' OR "id" LIKE 'deploy-dotted-removed-%'; keep the oldest row of each person and manager (a line saved in two workspaces after the deploy is two rows), DELETE FROM "UserDottedLine" d USING "UserDottedLine" e WHERE e."userId" = d."userId" AND e."managerId" = d."managerId" AND (e."createdAt", e."id") < (d."createdAt", d."id"); drop the columns, ALTER TABLE "UserDottedLine" DROP CONSTRAINT IF EXISTS "UserDottedLine_organizationId_fkey"; DROP INDEX IF EXISTS "UserDottedLine_userId_managerId_organizationId_key"; DROP INDEX IF EXISTS "UserDottedLine_organizationId_managerId_idx"; DROP INDEX IF EXISTS "UserDottedLine_organizationId_userId_idx"; ALTER TABLE "UserDottedLine" DROP COLUMN IF EXISTS "organizationId"; ALTER TABLE "OrganizationMembership" DROP CONSTRAINT IF EXISTS "OrganizationMembership_managerId_fkey"; DROP INDEX IF EXISTS "OrganizationMembership_organizationId_managerId_idx"; ALTER TABLE "OrganizationMembership" DROP COLUMN IF EXISTS "managerId"; restore the old unique, CREATE UNIQUE INDEX IF NOT EXISTS "UserDottedLine_userId_managerId_key" ON "UserDottedLine"("userId", "managerId"). A line set in one workspace after the deploy, or moved by a swap since (a membership's manager, the account's line after a move, a dotted line saved there), goes with its column: the release before this one holds one line per account. */

DO $$
BEGIN
  /* The person's manager in this workspace while the account is anchored elsewhere (E1). */
  IF NOT EXISTS (SELECT 1 FROM pg_attribute WHERE attrelid = '"OrganizationMembership"'::regclass AND attname = 'managerId' AND NOT attisdropped) THEN
    ALTER TABLE "OrganizationMembership" ADD COLUMN IF NOT EXISTS "managerId" TEXT;
  END IF;
  /* The workspace whose dotted line this is (E2): NOT NULL once the one-time step below has given every row one. */
  IF NOT EXISTS (SELECT 1 FROM pg_attribute WHERE attrelid = '"UserDottedLine"'::regclass AND attname = 'organizationId' AND NOT attisdropped) THEN
    ALTER TABLE "UserDottedLine" ADD COLUMN IF NOT EXISTS "organizationId" TEXT;
  END IF;
  /* "Who reports to Max here", for people working here through a membership.
     It leads with the manager (the step 1 review L4): both columns are
     equalities for reportsHereOf, and the key's ON DELETE SET NULL finds a
     deleted account's memberships by it, as "User_managerId_idx" serves
     User's own line, so the hard delete scans no table per person. */
  IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE schemaname = current_schema() AND indexname = 'OrganizationMembership_managerId_organizationId_idx') THEN
    CREATE INDEX IF NOT EXISTS "OrganizationMembership_managerId_organizationId_idx" ON "OrganizationMembership"("managerId", "organizationId");
  END IF;
  /* A manager's dotted reports here. */
  IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE schemaname = current_schema() AND indexname = 'UserDottedLine_organizationId_managerId_idx') THEN
    CREATE INDEX IF NOT EXISTS "UserDottedLine_organizationId_managerId_idx" ON "UserDottedLine"("organizationId", "managerId");
  END IF;
  /* A person's dotted managers here. */
  IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE schemaname = current_schema() AND indexname = 'UserDottedLine_organizationId_userId_idx') THEN
    CREATE INDEX IF NOT EXISTS "UserDottedLine_organizationId_userId_idx" ON "UserDottedLine"("organizationId", "userId");
  END IF;
END
$$;

/* ONE TIME (marker in the comment on the new "OrganizationMembership"."managerId"
   column, which a later COMMENT ON must keep): the membership lines, the
   account lines no workspace reads, and each dotted line's workspace, in
   the header's order. One statement: none runs without the others, and
   the marker is written with them. */
DO $$
BEGIN
  IF COALESCE(col_description('"OrganizationMembership"'::regclass,
       (SELECT attnum FROM pg_attribute WHERE attrelid = '"OrganizationMembership"'::regclass AND attname = 'managerId' AND NOT attisdropped)), '')
     NOT LIKE '%workspace-lines-2026-11-03%'
     /* The second guard (the step 1 review L2), one only this step changes: the dotted column is still nullable. */
     AND NOT (SELECT attnotnull FROM pg_attribute WHERE attrelid = '"UserDottedLine"'::regclass AND attname = 'organizationId' AND NOT attisdropped) THEN
    /* (i) Each membership of a workspace other than the anchor: the account's line, where that manager holds a row there in any state, and is not the person. */
    UPDATE "OrganizationMembership" m
       SET "managerId" = u."managerId"
      FROM "User" u
     WHERE m."userId" = u."id"
       AND m."organizationId" <> u."organizationId"
       AND m."managerId" IS NULL
       AND u."managerId" IS NOT NULL
       AND u."managerId" <> u."id"
       AND EXISTS (
         SELECT 1 FROM "User" x
          WHERE x."id" = u."managerId"
            AND (x."organizationId" = m."organizationId"
                 OR EXISTS (SELECT 1 FROM "OrganizationMembership" y WHERE y."userId" = x."id" AND y."organizationId" = m."organizationId")));
    /* (ii) The account's line, where the manager holds no row in the anchored workspace: cleared, its old value in an Audit row there, actor the system. */
    WITH stale AS (
      SELECT u."id", u."organizationId", u."managerId"
        FROM "User" u
       WHERE u."managerId" IS NOT NULL
         AND NOT EXISTS (
           SELECT 1 FROM "User" x
            WHERE x."id" = u."managerId"
              AND (x."organizationId" = u."organizationId"
                   OR EXISTS (SELECT 1 FROM "OrganizationMembership" y WHERE y."userId" = x."id" AND y."organizationId" = u."organizationId")))
    ), cleared AS (
      UPDATE "User" u
         SET "managerId" = NULL
        FROM stale s
       WHERE u."id" = s."id"
         AND u."managerId" = s."managerId"
      RETURNING u."id", s."organizationId", s."managerId" AS "oldManagerId"
    )
    INSERT INTO "ActivityLog" ("id", "type", "actorId", "actorType", "organizationId", "description", "targetId", "targetType", "severity", "oldValue", "newValue", "metadata", "createdAt")
    SELECT 'deploy-line-cleared-' || c."id", 'reporting_line_changed', NULL, 'system', c."organizationId",
           'Cleared a stored manager on the deploy: it named someone who does not work in this workspace, so no manager was shown here (each workspace now keeps its own reporting lines)',
           c."id", 'user', 'info',
           jsonb_build_object('managerId', c."oldManagerId"),
           jsonb_build_object('managerId', NULL),
           jsonb_build_object('onDeploy', 'workspace-lines-2026-11-03', 'reason', 'the manager holds no row in this workspace'),
           (now() AT TIME ZONE 'UTC')
      FROM cleared c
    ON CONFLICT ("id") DO NOTHING;
    /* The old dotted unique goes before the copies: a line read in two workspaces becomes two rows. */
    DROP INDEX IF EXISTS "UserDottedLine_userId_managerId_key";
    /* (iii) Each dotted line's workspace: the person's anchored one when the manager holds a row there, otherwise the first by id where both hold one, in any state. */
    UPDATE "UserDottedLine" d
       SET "organizationId" = COALESCE(
             (SELECT u."organizationId" FROM "User" u
               WHERE u."id" = d."userId"
                 AND (EXISTS (SELECT 1 FROM "User" x WHERE x."id" = d."managerId" AND x."organizationId" = u."organizationId")
                      OR EXISTS (SELECT 1 FROM "OrganizationMembership" y WHERE y."userId" = d."managerId" AND y."organizationId" = u."organizationId"))),
             (SELECT p."organizationId" FROM "OrganizationMembership" p
               WHERE p."userId" = d."userId"
                 AND (EXISTS (SELECT 1 FROM "User" x WHERE x."id" = d."managerId" AND x."organizationId" = p."organizationId")
                      OR EXISTS (SELECT 1 FROM "OrganizationMembership" y WHERE y."userId" = d."managerId" AND y."organizationId" = p."organizationId"))
               ORDER BY p."organizationId"
               LIMIT 1))
     WHERE d."organizationId" IS NULL;
    /* A copy for each other workspace where both hold a row, in any state. */
    INSERT INTO "UserDottedLine" ("id", "userId", "managerId", "organizationId", "role", "weight", "startDate", "endDate", "createdAt", "updatedAt")
    SELECT 'deploy-dotted-' || d."id" || '-' || w."organizationId", d."userId", d."managerId", w."organizationId",
           d."role", d."weight", d."startDate", d."endDate", d."createdAt", (now() AT TIME ZONE 'UTC')
      FROM "UserDottedLine" d
      JOIN (SELECT u."id" AS "userId", u."organizationId" FROM "User" u
            UNION
            SELECT p."userId", p."organizationId" FROM "OrganizationMembership" p) w ON w."userId" = d."userId"
     WHERE d."organizationId" IS NOT NULL
       AND w."organizationId" <> d."organizationId"
       AND (EXISTS (SELECT 1 FROM "User" x WHERE x."id" = d."managerId" AND x."organizationId" = w."organizationId")
            OR EXISTS (SELECT 1 FROM "OrganizationMembership" y WHERE y."userId" = d."managerId" AND y."organizationId" = w."organizationId"))
    ON CONFLICT ("id") DO NOTHING;
    /* A line no workspace reads: removed, carried in an Audit row in the person's anchored workspace, actor the system. */
    WITH stranded AS (
      DELETE FROM "UserDottedLine" d
       WHERE d."organizationId" IS NULL
      RETURNING d."id", d."userId", d."managerId", d."role", d."weight", d."startDate", d."endDate", d."createdAt"
    )
    INSERT INTO "ActivityLog" ("id", "type", "actorId", "actorType", "organizationId", "description", "targetId", "targetType", "severity", "oldValue", "newValue", "metadata", "createdAt")
    SELECT 'deploy-dotted-removed-' || s."id", 'reporting_line_changed', NULL, 'system', u."organizationId",
           'Removed a dotted line on the deploy that no workspace showed: its manager works in none of this person''s workspaces (each workspace now keeps its own dotted lines)',
           s."userId", 'user', 'info',
           jsonb_build_object('dottedManagerId', s."managerId"),
           jsonb_build_object('dottedManagerId', NULL),
           jsonb_build_object('onDeploy', 'workspace-lines-2026-11-03', 'reason', 'the manager holds no row in any workspace of this person',
                              'managerId', s."managerId", 'note', s."role", 'weight', s."weight", 'startDate', s."startDate", 'endDate', s."endDate", 'createdAt', s."createdAt"),
           (now() AT TIME ZONE 'UTC')
      FROM stranded s
      JOIN "User" u ON u."id" = s."userId"
    ON CONFLICT ("id") DO NOTHING;
    ALTER TABLE "UserDottedLine" ALTER COLUMN "organizationId" SET NOT NULL;
    CREATE UNIQUE INDEX IF NOT EXISTS "UserDottedLine_userId_managerId_organizationId_key" ON "UserDottedLine"("userId", "managerId", "organizationId");
    /* The marker, with the moment the step ran (T0, the window check's start: the step 1 review H1). */
    EXECUTE format('COMMENT ON COLUMN "OrganizationMembership"."managerId" IS %L',
      'The person''s manager in this workspace while the account is anchored elsewhere (User.managerId is the anchored workspace''s). Keep this marker in any new comment: workspace-lines-2026-11-03, applied '
        || to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI:SS.MS') || ' UTC');
  END IF;
END
$$;

/* The keys, last (see the header). Their place does the work, not NOT VALID
   (the step 1 review L1): the file is one transaction, so the share lock a
   key takes on "User" and "Organization" is held to the commit either way;
   being last, it is held only for the two validations below and the commit. */
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'OrganizationMembership_managerId_fkey' AND conrelid = '"OrganizationMembership"'::regclass) THEN
    ALTER TABLE "OrganizationMembership" ADD CONSTRAINT "OrganizationMembership_managerId_fkey"
      FOREIGN KEY ("managerId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE NOT VALID;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'UserDottedLine_organizationId_fkey' AND conrelid = '"UserDottedLine"'::regclass) THEN
    ALTER TABLE "UserDottedLine" ADD CONSTRAINT "UserDottedLine_organizationId_fkey"
      FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE NOT VALID;
  END IF;
END
$$;

/* Each key validated, only while it is not yet: a deploy after the first reads only the catalogue. */
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'OrganizationMembership_managerId_fkey' AND conrelid = '"OrganizationMembership"'::regclass AND NOT convalidated) THEN
    ALTER TABLE "OrganizationMembership" VALIDATE CONSTRAINT "OrganizationMembership_managerId_fkey";
  END IF;
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'UserDottedLine_organizationId_fkey' AND conrelid = '"UserDottedLine"'::regclass AND NOT convalidated) THEN
    ALTER TABLE "UserDottedLine" VALIDATE CONSTRAINT "UserDottedLine_organizationId_fkey";
  END IF;
END
$$;
