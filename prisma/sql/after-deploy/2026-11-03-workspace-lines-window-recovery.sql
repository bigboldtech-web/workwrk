/* The recovery for the window of 2026-11-03-workspace-lines.sql
   (docs/plans/workspace-status-2.md, the step 1 review H1): what
   2026-11-03-workspace-lines-window-check.sql lists as recoverable. NOT in
   the deploy manifest: run by hand, with psql -v ON_ERROR_STOP=1, right
   after the check, with T1 (the new release's first request, UTC, from the
   deploy log) written in place of <T1> in both statements; then run the
   check again.

   1. THE MOVES. For each move the release before made in the window (the
      check's list (b), "recoverable"), under the person's row lock: the
      membership left takes the account's line (that workspace's, carried
      across), and the account takes the line of its new workspace from that
      workspace's own membership row, where the file copied it (E11 i); for
      a row made in the window, the file's own rule (the account's line,
      where that manager holds a row there).
   2. THE MEMBERSHIPS MADE IN THE WINDOW (the check's list (d),
      "recoverable"): the file's copy, under the person's row lock.

   NEVER OVER A LINE THE NEW RELEASE WROTE: a row written since T1 is left
   (the account, the membership left and the new workspace's row alike),
   the left membership is written only while it is still NULL, and the
   account only while it still holds the line read. Each change has one
   ActivityLog row (actor the system, the old and new manager), its id
   "deploy-window-left-", "deploy-window-anchor-" or "deploy-window-made-"
   and the person's or the membership's id; a person or a membership with
   one is never matched again, so a second run changes nothing. Nothing is
   deleted. The handovers (list (c)) and anything not recoverable are set
   by hand. */

DO $$
BEGIN
  IF substring(COALESCE(col_description('"OrganizationMembership"'::regclass,
       (SELECT attnum FROM pg_attribute WHERE attrelid = '"OrganizationMembership"'::regclass AND attname = 'managerId' AND NOT attisdropped)), '')
       FROM 'workspace-lines-2026-11-03, applied ([0-9]{4}-[0-9]{2}-[0-9]{2} [0-9:.]+) UTC') IS NULL THEN
    RAISE EXCEPTION 'The comment on "OrganizationMembership"."managerId" holds no applied time (T0): 2026-11-03-workspace-lines.sql has not run here, or a later comment on that column dropped it. Take T0 from the deploy log line "deploy-migrations: applied 2026-11-03-workspace-lines.sql" and write it back into the comment as "workspace-lines-2026-11-03, applied YYYY-MM-DD HH24:MI:SS.MS UTC" before running this.';
  END IF;
END
$$;

/* 1. The moves. */
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
     FOR UPDATE OF u
), left_set AS (
  UPDATE "OrganizationMembership" l
     SET "managerId" = m."accountLine"
    FROM moved m
   WHERE l."id" = m."leftId"
     AND l."managerId" IS NULL
     AND m."accountLine" IS NOT NULL
  RETURNING l."userId", l."organizationId", l."managerId"
), anchor_set AS (
  UPDATE "User" u
     SET "managerId" = m."anchorLine"
    FROM moved m
   WHERE u."id" = m."userId"
     AND u."managerId" IS NOT DISTINCT FROM m."accountLine"
     AND m."anchorLine" IS DISTINCT FROM m."accountLine"
  RETURNING u."id", u."organizationId", m."accountLine" AS "was", u."managerId" AS "now"
)
INSERT INTO "ActivityLog" ("id", "type", "actorId", "actorType", "organizationId", "description", "targetId", "targetType", "severity", "oldValue", "newValue", "metadata", "createdAt")
SELECT 'deploy-window-left-' || s."userId", 'reporting_line_changed', NULL, 'system', s."organizationId",
       'Put back a reporting line after the deploy: a move made while the release before it served had left it behind',
       s."userId", 'user', 'info',
       jsonb_build_object('managerId', NULL), jsonb_build_object('managerId', s."managerId"),
       jsonb_build_object('onDeploy', 'workspace-lines-2026-11-03', 'reason', 'window recovery: the line of the workspace left, from the account'),
       (now() AT TIME ZONE 'UTC')
  FROM left_set s
UNION ALL
SELECT 'deploy-window-anchor-' || s."id", 'reporting_line_changed', NULL, 'system', s."organizationId",
       'Put back a reporting line after the deploy: a move made while the release before it served had carried in the line of the workspace left',
       s."id", 'user', 'info',
       jsonb_build_object('managerId', s."was"), jsonb_build_object('managerId', s."now"),
       jsonb_build_object('onDeploy', 'workspace-lines-2026-11-03', 'reason', 'window recovery: this workspace''s line, from its own membership row'),
       (now() AT TIME ZONE 'UTC')
  FROM anchor_set s
ON CONFLICT ("id") DO NOTHING;

/* 2. The memberships made in the window. */
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
     FOR UPDATE OF u
), fixed AS (
  UPDATE "OrganizationMembership" m
     SET "managerId" = d."line"
    FROM made d
   WHERE m."id" = d."membershipId"
     AND m."managerId" IS NULL
  RETURNING m."id", m."userId", m."organizationId", m."managerId"
)
INSERT INTO "ActivityLog" ("id", "type", "actorId", "actorType", "organizationId", "description", "targetId", "targetType", "severity", "oldValue", "newValue", "metadata", "createdAt")
SELECT 'deploy-window-made-' || f."id", 'reporting_line_changed', NULL, 'system', f."organizationId",
       'Copied a reporting line after the deploy onto a membership made while the release before it served, as the deploy copied every other',
       f."userId", 'user', 'info',
       jsonb_build_object('managerId', NULL), jsonb_build_object('managerId', f."managerId"),
       jsonb_build_object('onDeploy', 'workspace-lines-2026-11-03', 'reason', 'window recovery: the deploy''s copy, for a membership made in the window'),
       (now() AT TIME ZONE 'UTC')
  FROM fixed f
ON CONFLICT ("id") DO NOTHING;
