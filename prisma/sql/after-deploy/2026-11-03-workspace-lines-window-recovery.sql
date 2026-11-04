/* The recovery for the window of 2026-11-03-workspace-lines.sql
   (docs/plans/workspace-status-2.md, the step 1 review H1 and the final
   review, integrity H1): what 2026-11-03-workspace-lines-window-check.sql
   lists as recoverable. NOT in the deploy manifest: run by hand, with psql
   -v ON_ERROR_STOP=1, right after the check, with T1 (the new release's
   first request, UTC: the deploy log's "live: build" notice says "reloaded
   at YYYY-MM-DD HH:MM:SS UTC") written in place of <T1> in each of its three
   statements; then run the check again. After a deploy that stopped after
   that file (the check's header says which), T1 is the redeploy's.

   FROM THE SNAPSHOT AND THE FILE'S OWN RULES. The file copied every
   account's line and every dotted line into "_deploy_lines_2026_11_03_accounts"
   and "_deploy_lines_2026_11_03_dotted" just before it changed anything.
   What it then left each person in each workspace follows from those rows
   by its rules (E11): the line at T0 where that manager held a row in that
   workspace, none where they held none; each dotted line in every
   workspace where both held a row. So a line the window lost is put back,
   and one it carried in is cleared, however many moves came after it (Pat
   moved A to B in the window and back after the reload gets Max back in
   A), and a membership made in the window gets the file's copy.

   1. THE MEMBERSHIP LINES and 2. THE ACCOUNT LINES (the check's list (a),
      "recoverable"): each seat's line set to the one the file left it, on
      the row that holds the seat now: a membership elsewhere (1), the
      account where it is anchored (2). Two statements, so no statement
      writes a row it also locks.
   3. THE DOTTED LINES (the check's list (d), "recoverable"): each one the
      file left and the window took off, written back with its note, weight,
      dates and age.

   NEVER OVER A LINE WRITTEN ON PURPOSE: a person whose line there was
   written since the window opened (a line write recorded for them there, a
   join there, an Agent's reports moved or a bulk change of managers there),
   whose manager there joined around the deploy or ended since, or whose
   row was written in the last two minutes, is left for that workspace's
   Admin (the check says which). So is a line today's rules would refuse as
   a new one (the fixes review, finding 7): its manager is on the Agent tier
   at their seat there now, or it would close a loop in that workspace's
   lines as they stand now. Either may have come since the window, as
   nobody then reported to that manager there. Under each person's row lock (FOR UPDATE OF
   u, the lock every move and line write of the app waits for), read again
   under it: an account written since this statement began is left for the
   next run, and a row is written only while it still holds the line read.
   Each change has one ActivityLog row (actor the system, the old and new
   line), its id "deploy-window-line-" with the person's and the
   workspace's ids, or "deploy-window-dotted-" with the snapshot line's and
   the workspace's; a seat or a line with one is never put back again, so a
   second run changes nothing. Nothing is deleted. The handovers (list (c))
   and everything not recoverable are set by hand. Once the check lists
   nothing recoverable and the rest is set, drop the snapshot by hand
   (exactly, in the check's header). */

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

/* 1. The membership lines. */
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
           /* Today's rules for a new line there (the fixes review, finding 7; manager-candidate.ts
              managerCandidateIn and wouldLoopIn): never under someone on the Agent tier at their seat
              there (the account's level where anchored there, the membership's role otherwise, a
              removed seat none: acting-workspace.ts seatsHeldFor, org-role.ts isAgentOf), and never a
              loop through that workspace's lines as they stand now (lineAbove: from that manager up,
              each step the line of the seat held there, the account's where anchored there, a
              membership not removed otherwise, stopping where the line leaves the workspace, at most
              64 steps). Either may have come since the window: nobody reported to them there then. */
           WHEN e."expected" IS NOT NULL
                AND EXISTS (SELECT 1 FROM "User" x
                              LEFT JOIN "OrganizationMembership" xs ON xs."userId" = x."id" AND xs."organizationId" = j."organizationId" AND xs."removedAt" IS NULL
                             WHERE x."id" = e."expected"
                               AND CASE WHEN x."organizationId" = j."organizationId" THEN x."accessLevel" = 'AGENT' ELSE xs."role" = 'AGENT' END)
             THEN 'their manager there is on the Agent tier now, and an Agent can''t be anyone''s manager: set it by hand'
           WHEN e."expected" IS NOT NULL
                AND EXISTS (WITH RECURSIVE up ("id", "step") AS (
                              SELECT e."expected", 0
                              UNION
                              SELECT n."next", up."step" + 1
                                FROM up
                                CROSS JOIN LATERAL (SELECT CASE WHEN x."organizationId" = j."organizationId" THEN x."managerId" ELSE xs."managerId" END AS "next"
                                                      FROM "User" x
                                                      LEFT JOIN "OrganizationMembership" xs ON xs."userId" = x."id" AND xs."organizationId" = j."organizationId" AND xs."removedAt" IS NULL
                                                     WHERE x."id" = up."id" AND x."deletedAt" IS NULL) n
                               WHERE up."step" < 64 AND n."next" IS NOT NULL)
                            SELECT 1 FROM up WHERE up."id" = j."userId")
             THEN 'putting it back would make a loop in that workspace''s reporting lines: set it by hand'
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
),
held AS (
  /* The membership lines (a) marks recoverable, under the person's row
     lock, read again under it: still anchored where it was read and not
     written since. The account lines go in the next statement, so no row
     this one locks is written by it. */
  SELECT l."userId", l."organizationId", l."membershipId", l."line", l."expected"
    FROM lost l
    JOIN "User" u ON u."id" = l."userId" AND u."organizationId" = l."anchoredIn" AND u."updatedAt" = l."accountWrittenAt"
   WHERE l."state" = 'recoverable'
     AND l."membershipId" IS NOT NULL
     FOR UPDATE OF u
), membership_set AS (
  UPDATE "OrganizationMembership" m
     SET "managerId" = h."expected"
    FROM held h
   WHERE m."id" = h."membershipId"
     AND m."managerId" IS NOT DISTINCT FROM h."line"
  RETURNING m."userId", m."organizationId", h."line" AS "was", m."managerId" AS "now"
)
INSERT INTO "ActivityLog" ("id", "type", "actorId", "actorType", "organizationId", "description", "targetId", "targetType", "severity", "oldValue", "newValue", "metadata", "createdAt")
SELECT 'deploy-window-line-' || s."userId" || '-' || s."organizationId", 'reporting_line_changed', NULL, 'system', s."organizationId",
       CASE WHEN s."now" IS NULL
            THEN 'Cleared this person''s manager here after a WorkwrK update: a change made during the update had brought in their manager from another workspace.'
            ELSE 'Put back this person''s manager here after a WorkwrK update: a change made during the update had dropped or replaced it.'
       END,
       s."userId", 'user', 'info',
       jsonb_build_object('managerId', s."was"), jsonb_build_object('managerId', s."now"),
       jsonb_build_object('onDeploy', 'workspace-lines-2026-11-03', 'reason', 'window recovery: the line the deploy left, from its snapshot'),
       (now() AT TIME ZONE 'UTC')
  FROM membership_set s
ON CONFLICT ("id") DO NOTHING;

/* 2. The account lines. */
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
           /* Today's rules for a new line there (the fixes review, finding 7; manager-candidate.ts
              managerCandidateIn and wouldLoopIn): never under someone on the Agent tier at their seat
              there (the account's level where anchored there, the membership's role otherwise, a
              removed seat none: acting-workspace.ts seatsHeldFor, org-role.ts isAgentOf), and never a
              loop through that workspace's lines as they stand now (lineAbove: from that manager up,
              each step the line of the seat held there, the account's where anchored there, a
              membership not removed otherwise, stopping where the line leaves the workspace, at most
              64 steps). Either may have come since the window: nobody reported to them there then. */
           WHEN e."expected" IS NOT NULL
                AND EXISTS (SELECT 1 FROM "User" x
                              LEFT JOIN "OrganizationMembership" xs ON xs."userId" = x."id" AND xs."organizationId" = j."organizationId" AND xs."removedAt" IS NULL
                             WHERE x."id" = e."expected"
                               AND CASE WHEN x."organizationId" = j."organizationId" THEN x."accessLevel" = 'AGENT' ELSE xs."role" = 'AGENT' END)
             THEN 'their manager there is on the Agent tier now, and an Agent can''t be anyone''s manager: set it by hand'
           WHEN e."expected" IS NOT NULL
                AND EXISTS (WITH RECURSIVE up ("id", "step") AS (
                              SELECT e."expected", 0
                              UNION
                              SELECT n."next", up."step" + 1
                                FROM up
                                CROSS JOIN LATERAL (SELECT CASE WHEN x."organizationId" = j."organizationId" THEN x."managerId" ELSE xs."managerId" END AS "next"
                                                      FROM "User" x
                                                      LEFT JOIN "OrganizationMembership" xs ON xs."userId" = x."id" AND xs."organizationId" = j."organizationId" AND xs."removedAt" IS NULL
                                                     WHERE x."id" = up."id" AND x."deletedAt" IS NULL) n
                               WHERE up."step" < 64 AND n."next" IS NOT NULL)
                            SELECT 1 FROM up WHERE up."id" = j."userId")
             THEN 'putting it back would make a loop in that workspace''s reporting lines: set it by hand'
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
),
held AS (
  /* The account lines (a) marks recoverable, under the person's row lock,
     read again under it: still anchored where it was read and not written
     since. One row per account, so the row this locks is written once. */
  SELECT l."userId", l."organizationId", l."line", l."expected"
    FROM lost l
    JOIN "User" u ON u."id" = l."userId" AND u."organizationId" = l."anchoredIn" AND u."updatedAt" = l."accountWrittenAt"
   WHERE l."state" = 'recoverable'
     AND l."membershipId" IS NULL
     FOR UPDATE OF u
), account_set AS (
  UPDATE "User" u
     SET "managerId" = h."expected"
    FROM held h
   WHERE u."id" = h."userId"
     AND u."organizationId" = h."organizationId"
     AND u."managerId" IS NOT DISTINCT FROM h."line"
  RETURNING u."id" AS "userId", u."organizationId", h."line" AS "was", u."managerId" AS "now"
)
INSERT INTO "ActivityLog" ("id", "type", "actorId", "actorType", "organizationId", "description", "targetId", "targetType", "severity", "oldValue", "newValue", "metadata", "createdAt")
SELECT 'deploy-window-line-' || s."userId" || '-' || s."organizationId", 'reporting_line_changed', NULL, 'system', s."organizationId",
       CASE WHEN s."now" IS NULL
            THEN 'Cleared this person''s manager here after a WorkwrK update: a change made during the update had brought in their manager from another workspace.'
            ELSE 'Put back this person''s manager here after a WorkwrK update: a change made during the update had dropped or replaced it.'
       END,
       s."userId", 'user', 'info',
       jsonb_build_object('managerId', s."was"), jsonb_build_object('managerId', s."now"),
       jsonb_build_object('onDeploy', 'workspace-lines-2026-11-03', 'reason', 'window recovery: the line the deploy left, from its snapshot'),
       (now() AT TIME ZONE 'UTC')
  FROM account_set s
ON CONFLICT ("id") DO NOTHING;

/* 3. The dotted lines. */
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
),
held AS (
  /* What (d) marks recoverable, under the person's row lock. */
  SELECT g."lineId", g."userId", g."managerId", g."organizationId", g."role", g."weight", g."startDate", g."endDate", g."createdAt"
    FROM missing g
    JOIN "User" u ON u."id" = g."userId"
   WHERE g."state" = 'recoverable'
     FOR UPDATE OF u
), put AS (
  INSERT INTO "UserDottedLine" ("id", "userId", "managerId", "organizationId", "role", "weight", "startDate", "endDate", "createdAt", "updatedAt")
  SELECT 'deploy-window-dotted-' || h."lineId" || '-' || h."organizationId", h."userId", h."managerId", h."organizationId",
         h."role", h."weight", h."startDate", h."endDate", h."createdAt", (now() AT TIME ZONE 'UTC')
    FROM held h
  ON CONFLICT DO NOTHING
  RETURNING "id", "userId", "managerId", "organizationId", "role", "weight", "startDate", "endDate", "createdAt"
)
INSERT INTO "ActivityLog" ("id", "type", "actorId", "actorType", "organizationId", "description", "targetId", "targetType", "severity", "oldValue", "newValue", "metadata", "createdAt")
SELECT p."id", 'reporting_line_changed', NULL, 'system', p."organizationId",
       'Put back this person''s dotted line here after a WorkwrK update: a change made during the update had taken it off.',
       p."userId", 'user', 'info',
       jsonb_build_object('dottedManagerId', NULL), jsonb_build_object('dottedManagerId', p."managerId"),
       jsonb_build_object('onDeploy', 'workspace-lines-2026-11-03', 'reason', 'window recovery: the dotted line the deploy left, from its snapshot',
                          'managerId', p."managerId", 'note', p."role", 'weight', p."weight", 'startDate', p."startDate", 'endDate', p."endDate", 'createdAt', p."createdAt"),
       (now() AT TIME ZONE 'UTC')
  FROM put p
ON CONFLICT ("id") DO NOTHING;
