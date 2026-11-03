/* Right after every deploy of the release of 2026-11-03-workspace-lines.sql:
   the read-only check of the window (docs/plans/workspace-status-2.md, the
   step 1 review H1). NOT in the deploy manifest: run by hand, with psql
   -v ON_ERROR_STOP=1, as soon as the new release serves; and, if a deploy
   stopped after that file, again right after the redeploy.

   THE WINDOW is from the file (T0) to the new release's first request (T1).
   In it the release before serves on the new data: its moves (the switcher,
   D3's end, D6's restore, the D7 repair, an invitation joined with an
   existing account, the hard delete's move home) write no membership line
   and carry the account's line across; its handover moves account lines
   only; a membership it makes gets no copy of the account's line; its
   dotted-line writes delete by person and manager. None of it leaves a
   record, so this lists what the rows still show.

   T0 is read from the marker comment ("applied ... UTC"); T1, the reload's
   moment in UTC from the deploy log, is written in place of <T1> in each
   statement (left as it is, the statement fails). Every list starts five
   minutes before T0 (see the w CTE).

   1. The window itself.
   2. (a) Account lines naming someone with no row in the account's
      anchored workspace. The file left none and the new release writes
      none: each is a line the release before carried in on a move.
   3. (b) The moves it made: an account and a membership elsewhere written
      in the window, that membership's line NULL. "recoverable" is true for
      the ones the recovery puts back; look at the others by hand.
   4. (c) Membership lines naming someone whose seat in that workspace ended
      since T0: its handover moved account lines only. That workspace's
      Admin sets each line (Members, Reports to).
   5. (d) Memberships it made in the window with no line where the file
      would have copied the account's; "recoverable" as in (b).
   6. (e) Its dotted-line writes in the window, from their Audit rows: each
      may have taken a copy of the line off in another workspace of the
      person; that workspace's Admin adds it back.

   If (a), (b) or (d) lists anything, run
   2026-11-03-workspace-lines-window-recovery.sql, then this again. */

DO $$
BEGIN
  IF substring(COALESCE(col_description('"OrganizationMembership"'::regclass,
       (SELECT attnum FROM pg_attribute WHERE attrelid = '"OrganizationMembership"'::regclass AND attname = 'managerId' AND NOT attisdropped)), '')
       FROM 'workspace-lines-2026-11-03, applied ([0-9]{4}-[0-9]{2}-[0-9]{2} [0-9:.]+) UTC') IS NULL THEN
    RAISE EXCEPTION 'The comment on "OrganizationMembership"."managerId" holds no applied time (T0): 2026-11-03-workspace-lines.sql has not run here, or a later comment on that column dropped it. Take T0 from the deploy log line "deploy-migrations: applied 2026-11-03-workspace-lines.sql" and write it back into the comment as "workspace-lines-2026-11-03, applied YYYY-MM-DD HH24:MI:SS.MS UTC" before running this.';
  END IF;
END
$$;

/* 1. The window. */
WITH w AS (
  /* T0, from the marker comment the file wrote (less five minutes: a move the
     release before began just before the file waited for its lock and was
     stamped by the app's clock), and T1, the new release's first request,
     from the deploy log. Left as <T1>, the statement fails: not a timestamp. */
  SELECT substring(col_description(c.attrelid, c.attnum) FROM 'applied ([0-9]{4}-[0-9]{2}-[0-9]{2} [0-9:.]+) UTC')::timestamp - interval '5 minutes' AS "t0",
         '<T1>'::timestamp AS "t1"
    FROM pg_attribute c
   WHERE c.attrelid = '"OrganizationMembership"'::regclass AND c.attname = 'managerId' AND NOT c.attisdropped
)
SELECT w."t0" + interval '5 minutes' AS "T0", w."t1" AS "T1" FROM w;

/* 2. (a) Lines carried in. */
SELECT u."id" AS "userId", u."organizationId" AS "anchoredIn", u."managerId", u."updatedAt"
  FROM "User" u
 WHERE u."managerId" IS NOT NULL
   AND NOT EXISTS (SELECT 1 FROM "User" x WHERE x."id" = u."managerId" AND (x."organizationId" = u."organizationId" OR EXISTS (SELECT 1 FROM "OrganizationMembership" y WHERE y."userId" = x."id" AND y."organizationId" = u."organizationId")));

/* 3. (b) The moves. */
WITH w AS (
  /* T0, from the marker comment the file wrote (less five minutes: a move the
     release before began just before the file waited for its lock and was
     stamped by the app's clock), and T1, the new release's first request,
     from the deploy log. Left as <T1>, the statement fails: not a timestamp. */
  SELECT substring(col_description(c.attrelid, c.attnum) FROM 'applied ([0-9]{4}-[0-9]{2}-[0-9]{2} [0-9:.]+) UTC')::timestamp - interval '5 minutes' AS "t0",
         '<T1>'::timestamp AS "t1"
    FROM pg_attribute c
   WHERE c.attrelid = '"OrganizationMembership"'::regclass AND c.attname = 'managerId' AND NOT c.attisdropped
),
moved AS (
  /* A move the release before made in the window: the account and one
     membership elsewhere (the one it left) written together in the window,
     that membership's line NULL, the account's line the left workspace's
     (or none), and nothing written since T1. */
  SELECT u."id" AS "userId", u."organizationId" AS "anchoredIn", u."managerId" AS "accountLine",
         l."id" AS "leftId", l."organizationId" AS "leftIn",
         CASE
           WHEN r."managerId" IS NULL AND r."createdAt" >= w."t0"
                AND u."managerId" IS NOT NULL AND u."managerId" <> u."id"
                AND EXISTS (SELECT 1 FROM "User" x WHERE x."id" = u."managerId" AND (x."organizationId" = r."organizationId" OR EXISTS (SELECT 1 FROM "OrganizationMembership" y WHERE y."userId" = x."id" AND y."organizationId" = r."organizationId")))
             THEN u."managerId"
           ELSE r."managerId"
         END AS "anchorLine"
    FROM w
    JOIN "User" u ON u."updatedAt" BETWEEN w."t0" AND w."t1"
    JOIN "OrganizationMembership" l ON l."userId" = u."id" AND l."organizationId" <> u."organizationId"
                                   AND l."managerId" IS NULL AND l."updatedAt" BETWEEN w."t0" AND w."t1"
    JOIN "OrganizationMembership" r ON r."userId" = u."id" AND r."organizationId" = u."organizationId" AND r."updatedAt" <= w."t1"
   WHERE abs(extract(epoch FROM (u."updatedAt" - l."updatedAt"))) < 60
     AND (u."managerId" IS NULL OR EXISTS (SELECT 1 FROM "User" x WHERE x."id" = u."managerId" AND (x."organizationId" = l."organizationId" OR EXISTS (SELECT 1 FROM "OrganizationMembership" y WHERE y."userId" = x."id" AND y."organizationId" = l."organizationId"))))
     AND NOT EXISTS (SELECT 1 FROM "OrganizationMembership" o
                      WHERE o."userId" = u."id" AND o."id" <> l."id" AND o."organizationId" <> u."organizationId"
                        AND o."managerId" IS NULL AND o."updatedAt" BETWEEN w."t0" AND w."t1")
     AND NOT EXISTS (SELECT 1 FROM "ActivityLog" a WHERE a."id" IN ('deploy-window-left-' || u."id", 'deploy-window-anchor-' || u."id"))
)
SELECT u."id" AS "userId", u."organizationId" AS "anchoredIn", u."managerId" AS "accountLine",
       l."organizationId" AS "leftIn", u."updatedAt" AS "accountWrittenAt", l."updatedAt" AS "leftWrittenAt",
       EXISTS (SELECT 1 FROM moved m WHERE m."userId" = u."id" AND m."leftId" = l."id") AS "recoverable"
  FROM w
  JOIN "User" u ON u."updatedAt" >= w."t0"
  JOIN "OrganizationMembership" l ON l."userId" = u."id" AND l."organizationId" <> u."organizationId"
                                 AND l."managerId" IS NULL AND l."updatedAt" BETWEEN w."t0" AND w."t1";

/* 4. (c) Handovers. */
WITH w AS (
  /* T0, from the marker comment the file wrote (less five minutes: a move the
     release before began just before the file waited for its lock and was
     stamped by the app's clock), and T1, the new release's first request,
     from the deploy log. Left as <T1>, the statement fails: not a timestamp. */
  SELECT substring(col_description(c.attrelid, c.attnum) FROM 'applied ([0-9]{4}-[0-9]{2}-[0-9]{2} [0-9:.]+) UTC')::timestamp - interval '5 minutes' AS "t0",
         '<T1>'::timestamp AS "t1"
    FROM pg_attribute c
   WHERE c.attrelid = '"OrganizationMembership"'::regclass AND c.attname = 'managerId' AND NOT c.attisdropped
)
SELECT m."userId", m."organizationId", m."managerId" AS "endedManagerId",
       GREATEST(x."updatedAt", xs."updatedAt") AS "seatChangedAt"
  FROM w
  JOIN "OrganizationMembership" m ON m."managerId" IS NOT NULL
  JOIN "User" p ON p."id" = m."userId" AND p."organizationId" <> m."organizationId"
  JOIN "User" x ON x."id" = m."managerId"
  LEFT JOIN "OrganizationMembership" xs ON xs."userId" = x."id" AND xs."organizationId" = m."organizationId" AND x."organizationId" <> m."organizationId"
 WHERE (x."organizationId" = m."organizationId" AND (x."status" = 'INACTIVE' OR x."deletedAt" IS NOT NULL) AND x."updatedAt" >= w."t0")
    OR (xs."id" IS NOT NULL AND (xs."status" = 'INACTIVE' OR xs."removedAt" IS NOT NULL) AND xs."updatedAt" >= w."t0")
    OR (xs."id" IS NOT NULL AND (x."status" = 'INACTIVE' OR x."deletedAt" IS NOT NULL) AND x."updatedAt" >= w."t0");

/* 5. (d) Memberships made in the window. */
WITH w AS (
  /* T0, from the marker comment the file wrote (less five minutes: a move the
     release before began just before the file waited for its lock and was
     stamped by the app's clock), and T1, the new release's first request,
     from the deploy log. Left as <T1>, the statement fails: not a timestamp. */
  SELECT substring(col_description(c.attrelid, c.attnum) FROM 'applied ([0-9]{4}-[0-9]{2}-[0-9]{2} [0-9:.]+) UTC')::timestamp - interval '5 minutes' AS "t0",
         '<T1>'::timestamp AS "t1"
    FROM pg_attribute c
   WHERE c.attrelid = '"OrganizationMembership"'::regclass AND c.attname = 'managerId' AND NOT c.attisdropped
),
made AS (
  /* A membership the release before made in the window, of an account it
     did not move (not written since before the window), with no line where
     the file would have copied the account's: the manager holds a row there. */
  SELECT m."id" AS "membershipId", m."userId", m."organizationId", u."managerId" AS "line"
    FROM w
    JOIN "OrganizationMembership" m ON m."createdAt" BETWEEN w."t0" AND w."t1" AND m."updatedAt" <= w."t1" AND m."managerId" IS NULL
    JOIN "User" u ON u."id" = m."userId" AND u."organizationId" <> m."organizationId" AND u."updatedAt" < w."t0"
   WHERE u."managerId" IS NOT NULL AND u."managerId" <> u."id"
     AND EXISTS (SELECT 1 FROM "User" x WHERE x."id" = u."managerId" AND (x."organizationId" = m."organizationId" OR EXISTS (SELECT 1 FROM "OrganizationMembership" y WHERE y."userId" = x."id" AND y."organizationId" = m."organizationId")))
     AND NOT EXISTS (SELECT 1 FROM "ActivityLog" a WHERE a."id" = 'deploy-window-made-' || m."id")
)
SELECT m."id" AS "membershipId", m."userId", m."organizationId", u."managerId" AS "accountLine", m."createdAt",
       EXISTS (SELECT 1 FROM made d WHERE d."membershipId" = m."id") AS "recoverable"
  FROM w
  JOIN "OrganizationMembership" m ON m."createdAt" BETWEEN w."t0" AND w."t1" AND m."managerId" IS NULL
  JOIN "User" u ON u."id" = m."userId" AND u."organizationId" <> m."organizationId"
 WHERE u."managerId" IS NOT NULL AND u."managerId" <> u."id"
   AND EXISTS (SELECT 1 FROM "User" x WHERE x."id" = u."managerId" AND (x."organizationId" = m."organizationId" OR EXISTS (SELECT 1 FROM "OrganizationMembership" y WHERE y."userId" = x."id" AND y."organizationId" = m."organizationId")));

/* 6. (e) Dotted-line writes in the window. */
WITH w AS (
  /* T0, from the marker comment the file wrote (less five minutes: a move the
     release before began just before the file waited for its lock and was
     stamped by the app's clock), and T1, the new release's first request,
     from the deploy log. Left as <T1>, the statement fails: not a timestamp. */
  SELECT substring(col_description(c.attrelid, c.attnum) FROM 'applied ([0-9]{4}-[0-9]{2}-[0-9]{2} [0-9:.]+) UTC')::timestamp - interval '5 minutes' AS "t0",
         '<T1>'::timestamp AS "t1"
    FROM pg_attribute c
   WHERE c.attrelid = '"OrganizationMembership"'::regclass AND c.attname = 'managerId' AND NOT c.attisdropped
)
SELECT a."organizationId", a."targetId" AS "userId", a."createdAt", a."oldValue", a."metadata"
  FROM w
  JOIN "ActivityLog" a ON a."createdAt" BETWEEN w."t0" AND w."t1"
 WHERE a."type" = 'reporting_line_changed'
   AND a."id" NOT LIKE 'deploy-%'
   AND (a."oldValue" ? 'dottedManagerId' OR a."metadata" ? 'dottedManagerIds');
