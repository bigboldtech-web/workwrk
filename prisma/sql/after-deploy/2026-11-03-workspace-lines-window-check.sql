/* Right after every deploy of the release of 2026-11-03-workspace-lines.sql:
   the read-only check of the window (docs/plans/workspace-status-2.md, the
   step 1 review H1 and the final review, integrity H1). NOT in the deploy
   manifest: run by hand, with psql -v ON_ERROR_STOP=1, as soon as the new
   release serves; and, if a deploy stopped after that file, again right
   after the redeploy.

   THE WINDOW is from the file (T0) to the new release's first request (T1).
   In it the release before serves on the new data: its moves (the switcher,
   D3's end, D6's restore, the D7 repair, an invitation joined with an
   existing account, the hard delete's move home) write no membership line
   and carry the account's line across; its handover moves account lines
   only; a membership it makes gets no copy of the account's line; its
   dotted-line writes delete by person and manager. None of it leaves a
   record, and the new release's own moves then carry what the window left:
   Pat moved A to B in the window and back after the reload holds no row
   that shows A lost Max.

   SO THIS READS THE SNAPSHOT the file took just before it changed anything
   ("_deploy_lines_2026_11_03_accounts" and "_deploy_lines_2026_11_03_dotted"),
   and compares every line each person holds now with the line the file left
   them, by the file's own rules. It finds a lost or carried line however
   many moves came after, a move back after the reload included, so it is as
   complete an hour after the reload as a minute after it. Run it at once all
   the same: until the recovery runs, that person reports to nobody, or to
   the wrong person, in that workspace, and a line written by hand meanwhile
   is left to that workspace's Admin.

   T0 is read from the marker comment ("applied ... UTC"); T1, the reload's
   moment in UTC from the deploy log, is written in place of <T1> in each
   statement (left as it is, the statement fails). Every list starts five
   minutes before T0 (see the w CTE).

   1. The window itself.
   2. (a) Every account and membership line that is not what the file left
      it, from the snapshot: a line a move lost (the workspace left), a line
      a move carried in (the workspace arrived in), a membership made in the
      window with no copy, each through any number of later moves. A line
      written on purpose since the window opened and still as written (the
      newest line write recorded for that person there names it) is not
      listed. "state" is "recoverable" for what the recovery puts back, and
      otherwise says why it is left for that workspace's Admin.
   3. (b) Every account or membership line naming someone with no row in
      that workspace. The file left none and the new release writes none:
      each is a line carried in. The recovery clears the ones (a) marks
      recoverable.
   4. (c) Membership lines naming someone whose seat in that workspace ended
      since T0: the release before's handover moved account lines only.
      That workspace's Admin sets each line (Members, Reports to).
   5. (d) Every dotted line the file left (each snapshot line in each
      workspace where the person and the manager both held a row) that is
      not there now, with "state" as in (a).
   6. (e) The release before's dotted-line writes in the window, from their
      Audit rows, for reference.

   If (a), (b) or (d) lists anything, run
   2026-11-03-workspace-lines-window-recovery.sql, then this again. When
   this lists nothing recoverable and that workspace's Admin has set the
   rest, drop the snapshot by hand, with exactly:
     DROP TABLE IF EXISTS "_deploy_lines_2026_11_03_accounts";
     DROP TABLE IF EXISTS "_deploy_lines_2026_11_03_dotted";
   No file runs those two statements. */

DO $$
BEGIN
  IF substring(COALESCE(col_description('"OrganizationMembership"'::regclass,
       (SELECT attnum FROM pg_attribute WHERE attrelid = '"OrganizationMembership"'::regclass AND attname = 'managerId' AND NOT attisdropped)), '')
       FROM 'workspace-lines-2026-11-03, applied ([0-9]{4}-[0-9]{2}-[0-9]{2} [0-9:.]+) UTC') IS NULL THEN
    RAISE EXCEPTION 'The comment on "OrganizationMembership"."managerId" holds no applied time (T0): 2026-11-03-workspace-lines.sql has not run here, or a later comment on that column dropped it. Take T0 from the deploy log line "deploy-migrations: applied 2026-11-03-workspace-lines.sql" and write it back into the comment as "workspace-lines-2026-11-03, applied YYYY-MM-DD HH24:MI:SS.MS UTC" before running this.';
  END IF;
  IF to_regclass('"_deploy_lines_2026_11_03_accounts"') IS NULL OR to_regclass('"_deploy_lines_2026_11_03_dotted"') IS NULL THEN
    RAISE EXCEPTION 'The snapshot tables "_deploy_lines_2026_11_03_accounts" and "_deploy_lines_2026_11_03_dotted" are not here: they were dropped once the check was clean, so there is nothing left to check, or 2026-11-03-workspace-lines.sql ran here before it took a snapshot.';
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

/* 2. (a) The account and membership lines the window lost or carried, from the snapshot. */
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
log AS (
  /* What may have written a line on purpose since the window opened, by
     either release: a line write recorded for one person, a join, an
     Agent's reports moved or a bulk change of managers (these two name no
     person). The deploy's and the recovery's own rows are left out. */
  SELECT a."id", a."type", a."organizationId", a."targetId", a."actorId", a."createdAt", a."oldValue", a."newValue", a."metadata"
    FROM "ActivityLog" a
    CROSS JOIN w
   WHERE a."createdAt" >= w."t0"
     AND a."id" NOT LIKE 'deploy-%'
     AND a."type" IN ('reporting_line_changed', 'user.joined', 'bulk_update')
),
seats AS (
  /* Every seat each account of the snapshot holds now, with the line it
     holds there now: the account for the workspace it is anchored to, a
     membership for each other one, never the anchored workspace's own stale
     row. "heldAtT0": the workspace the account was anchored to at T0.
     "since": when the row of any other seat was made (for the account, its
     own membership row there, the one it moved into). "rowWrittenAt": when
     the row that holds the line was last written. */
  SELECT s."id" AS "userId", u."organizationId", u."managerId" AS "line", NULL::text AS "membershipId",
         u."organizationId" AS "anchoredIn", u."updatedAt" AS "accountWrittenAt", u."updatedAt" AS "rowWrittenAt",
         s."organizationId" AS "anchoredAtT0", s."managerId" AS "lineAtT0",
         u."organizationId" = s."organizationId" AS "heldAtT0",
         (SELECT r."createdAt" FROM "OrganizationMembership" r WHERE r."userId" = u."id" AND r."organizationId" = u."organizationId") AS "since"
    FROM "_deploy_lines_2026_11_03_accounts" s
    JOIN "User" u ON u."id" = s."id"
  UNION ALL
  SELECT s."id", m."organizationId", m."managerId", m."id",
         u."organizationId", u."updatedAt", m."updatedAt",
         s."organizationId", s."managerId",
         m."organizationId" = s."organizationId",
         m."createdAt"
    FROM "_deploy_lines_2026_11_03_accounts" s
    JOIN "User" u ON u."id" = s."id"
    JOIN "OrganizationMembership" m ON m."userId" = u."id" AND m."organizationId" <> u."organizationId"
),
judged AS (
  /* Each seat held before the reload (held at T0, or its row made before
     T1), with what the file's rules say of the line at T0 there (E11 i and
     ii): it "qualifies" when it names someone still here who is not the
     person (a line to oneself only where the account was anchored, as the
     file kept it); "certain" when that manager held a row in that workspace
     at T0 (anchored there in the snapshot, or a membership made before the
     window), so the file copied or kept it; "recent" when that manager's
     row there was made around the deploy, so the file may not have seen it.
     "managerEnded": that manager's seat there, or their account, ended
     since the window opened. "touched": a line write that may be on purpose
     since then (log). "explained": the newest line write recorded for this
     person there names the line they hold now. "putBack": the recovery put
     this seat's line back once already. "justWritten": the row holding the
     line was written in the last two minutes (an edit whose Audit row is
     written just after its commit). */
  SELECT t.*,
         t."lineAtT0" IS NOT NULL AND (t."lineAtT0" <> t."userId" OR t."organizationId" = t."anchoredAtT0")
           AND EXISTS (SELECT 1 FROM "User" z WHERE z."id" = t."lineAtT0") AS "qualifies",
         EXISTS (SELECT 1 FROM "_deploy_lines_2026_11_03_accounts" x WHERE x."id" = t."lineAtT0" AND x."organizationId" = t."organizationId")
           OR EXISTS (SELECT 1 FROM "OrganizationMembership" y WHERE y."userId" = t."lineAtT0" AND y."organizationId" = t."organizationId" AND y."createdAt" < w."t0") AS "certain",
         EXISTS (SELECT 1 FROM "OrganizationMembership" y WHERE y."userId" = t."lineAtT0" AND y."organizationId" = t."organizationId" AND y."createdAt" >= w."t0") AS "recent",
         EXISTS (SELECT 1 FROM "User" x WHERE x."id" = t."lineAtT0"
                    AND (((x."status" = 'INACTIVE' OR x."deletedAt" IS NOT NULL) AND x."updatedAt" >= w."t0")
                         OR EXISTS (SELECT 1 FROM "OrganizationMembership" xs WHERE xs."userId" = x."id" AND xs."organizationId" = t."organizationId" AND x."organizationId" <> t."organizationId"
                                       AND (xs."status" = 'INACTIVE' OR xs."removedAt" IS NOT NULL) AND xs."updatedAt" >= w."t0"))) AS "managerEnded",
         EXISTS (SELECT 1 FROM log a WHERE a."organizationId" = t."organizationId"
                    AND ((a."type" = 'reporting_line_changed' AND a."targetId" = t."userId" AND (a."oldValue" ? 'managerId' OR a."newValue" ? 'managerId'))
                         OR (a."type" = 'reporting_line_changed' AND a."metadata" ? 'agentReports')
                         OR (a."type" = 'user.joined' AND a."actorId" = t."userId")
                         OR (a."type" = 'bulk_update' AND a."metadata" ->> 'action' = 'change_manager'))) AS "touched",
         EXISTS (SELECT 1 FROM (SELECT a."newValue" ->> 'managerId' AS "m" FROM log a
                                  WHERE a."organizationId" = t."organizationId" AND a."targetId" = t."userId" AND a."type" = 'reporting_line_changed' AND a."newValue" ? 'managerId'
                                  ORDER BY a."createdAt" DESC, a."id" DESC LIMIT 1) n
                  WHERE n."m" IS NOT DISTINCT FROM t."line") AS "explained",
         EXISTS (SELECT 1 FROM "ActivityLog" p WHERE p."id" = 'deploy-window-line-' || t."userId" || '-' || t."organizationId") AS "putBack",
         t."rowWrittenAt" > (now() AT TIME ZONE 'UTC') - interval '2 minutes' AS "justWritten"
    FROM seats t
    CROSS JOIN w
   WHERE t."heldAtT0" OR t."since" <= w."t1"
),
lost AS (
  /* The seats whose line now is not the one the file left them (for a
     manager who joined around the deploy, not the snapshot's line either),
     and not written on purpose since, with what the recovery may do. */
  SELECT j."userId", j."organizationId", j."membershipId", j."anchoredIn", j."accountWrittenAt", j."line", e."expected", j."lineAtT0",
         CASE
           WHEN j."touched" THEN 'a line was written for them there since the deploy: set it by hand'
           WHEN e."ambiguous" THEN 'their manager joined that workspace around the deploy: set it by hand'
           WHEN e."expected" IS NOT NULL AND j."managerEnded" THEN 'that manager''s seat there ended since the deploy: set it by hand'
           WHEN j."putBack" THEN 'put back once already and changed since: set it by hand'
           WHEN j."justWritten" THEN 'written a moment ago: run the check again in two minutes'
           ELSE 'recoverable'
         END AS "state"
    FROM judged j
    CROSS JOIN LATERAL (
      SELECT CASE WHEN j."qualifies" AND j."certain" THEN j."lineAtT0" END AS "expected",
             j."qualifies" AND NOT j."certain" AND j."recent" AS "ambiguous"
    ) e
   WHERE NOT j."explained"
     AND CASE WHEN e."ambiguous" THEN j."line" IS DISTINCT FROM j."lineAtT0" ELSE j."line" IS DISTINCT FROM e."expected" END
)
SELECT l."userId", l."organizationId" AS "workspace", CASE WHEN l."membershipId" IS NULL THEN 'account' ELSE 'membership' END AS "heldOn",
       l."line" AS "lineNow", l."expected" AS "lineTheDeployLeft", l."lineAtT0" AS "lineBeforeTheDeploy", l."state"
  FROM lost l
 ORDER BY l."organizationId", l."userId";

/* 3. (b) Lines naming someone with no row in that workspace. */
SELECT u."id" AS "userId", u."organizationId" AS "workspace", 'account' AS "heldOn", u."managerId", u."updatedAt"
  FROM "User" u
 WHERE u."managerId" IS NOT NULL
   AND NOT EXISTS (SELECT 1 FROM "User" x WHERE x."id" = u."managerId" AND (x."organizationId" = u."organizationId" OR EXISTS (SELECT 1 FROM "OrganizationMembership" y WHERE y."userId" = x."id" AND y."organizationId" = u."organizationId")))
UNION ALL
SELECT m."userId", m."organizationId", 'membership', m."managerId", m."updatedAt"
  FROM "OrganizationMembership" m
  JOIN "User" u ON u."id" = m."userId" AND u."organizationId" <> m."organizationId"
 WHERE m."managerId" IS NOT NULL
   AND NOT EXISTS (SELECT 1 FROM "User" x WHERE x."id" = m."managerId" AND (x."organizationId" = m."organizationId" OR EXISTS (SELECT 1 FROM "OrganizationMembership" y WHERE y."userId" = x."id" AND y."organizationId" = m."organizationId")));

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

/* 5. (d) The dotted lines the window took off, from the snapshot. */
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
log AS (
  /* What may have written a line on purpose since the window opened, by
     either release: a line write recorded for one person, a join, an
     Agent's reports moved or a bulk change of managers (these two name no
     person). The deploy's and the recovery's own rows are left out. */
  SELECT a."id", a."type", a."organizationId", a."targetId", a."actorId", a."createdAt", a."oldValue", a."newValue", a."metadata"
    FROM "ActivityLog" a
    CROSS JOIN w
   WHERE a."createdAt" >= w."t0"
     AND a."id" NOT LIKE 'deploy-%'
     AND a."type" IN ('reporting_line_changed', 'user.joined', 'bulk_update')
),
missing AS (
  /* Each snapshot dotted line in each workspace where the person and the
     manager both held a row at T0 (anchored there in the snapshot, or a
     membership made before the window): where the file left it (E11 iii).
     Listed when it is not there now, the person, the manager and the
     workspace all still here, with what the recovery may do: never a line
     of someone whose lines there were written since the window opened (a
     dotted-line save, a restore's clears, an Agent's reports moved). */
  SELECT d."id" AS "lineId", d."userId", d."managerId", p."organizationId", d."role", d."weight", d."startDate", d."endDate", d."createdAt",
         CASE
           WHEN EXISTS (SELECT 1 FROM log a WHERE a."organizationId" = p."organizationId" AND a."type" = 'reporting_line_changed' AND (a."targetId" = d."userId" OR a."metadata" ? 'agentReports'))
             THEN 'their lines there were written since the deploy: add it back by hand if it belongs'
           WHEN EXISTS (SELECT 1 FROM "User" x WHERE x."id" = d."managerId"
                           AND (((x."status" = 'INACTIVE' OR x."deletedAt" IS NOT NULL) AND x."updatedAt" >= w."t0")
                                OR EXISTS (SELECT 1 FROM "OrganizationMembership" xs WHERE xs."userId" = x."id" AND xs."organizationId" = p."organizationId" AND x."organizationId" <> p."organizationId"
                                              AND (xs."status" = 'INACTIVE' OR xs."removedAt" IS NOT NULL) AND xs."updatedAt" >= w."t0")))
             THEN 'that manager''s seat there ended since the deploy: add it back by hand if it belongs'
           WHEN EXISTS (SELECT 1 FROM "ActivityLog" b WHERE b."id" = 'deploy-window-dotted-' || d."id" || '-' || p."organizationId")
             THEN 'put back once already and taken off since: add it back by hand if it belongs'
           ELSE 'recoverable'
         END AS "state"
    FROM "_deploy_lines_2026_11_03_dotted" d
    CROSS JOIN w
    JOIN (SELECT s."id" AS "userId", s."organizationId" FROM "_deploy_lines_2026_11_03_accounts" s
          UNION
          SELECT y."userId", y."organizationId" FROM "OrganizationMembership" y CROSS JOIN w WHERE y."createdAt" < w."t0") p ON p."userId" = d."userId"
   WHERE (EXISTS (SELECT 1 FROM "_deploy_lines_2026_11_03_accounts" x WHERE x."id" = d."managerId" AND x."organizationId" = p."organizationId")
          OR EXISTS (SELECT 1 FROM "OrganizationMembership" y WHERE y."userId" = d."managerId" AND y."organizationId" = p."organizationId" AND y."createdAt" < w."t0"))
     AND EXISTS (SELECT 1 FROM "User" z WHERE z."id" = d."userId")
     AND EXISTS (SELECT 1 FROM "User" z WHERE z."id" = d."managerId")
     AND EXISTS (SELECT 1 FROM "Organization" o WHERE o."id" = p."organizationId")
     AND NOT EXISTS (SELECT 1 FROM "UserDottedLine" e WHERE e."userId" = d."userId" AND e."managerId" = d."managerId" AND e."organizationId" = p."organizationId")
)
SELECT g."userId", g."organizationId" AS "workspace", g."managerId" AS "dottedManagerId", g."lineId", g."state"
  FROM missing g
 ORDER BY g."organizationId", g."userId";

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
