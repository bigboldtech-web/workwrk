import { prisma } from "@/lib/prisma";
import { managesNobody } from "@/lib/access/manager-lines";
import { keptSeatSql, liveSeatSql } from "@/lib/access/workspace-seat";

/**
 * Returns the set of user IDs in `rootUserId`'s team, self + all direct and
 * indirect reports, scoped to `organizationId`. Uses a recursive CTE so the
 * walk happens in the database (indexed on `managerId`) instead of fetching
 * every org user and walking the tree in Node. Scales to thousands of users.
 *
 * An Agent is never anyone's manager (AGENT_TIER_BLURB): rooted at an Agent,
 * the team is the Agent alone, whatever lines stored before rule 6 say. An
 * Agent further down is walked through as before (src/lib/access/manager-lines.ts).
 * The root's tier is the one held in `organizationId`, never their anchored
 * row's level in another workspace, and a root who works here through a
 * membership (anchored elsewhere) keeps the team they manage here. So do the
 * people below (docs-found fixes batch 5): everyone who holds a level here,
 * anchored here or through a membership, so a report who last switched to
 * another workspace on any device stays in their manager's team here.
 *
 * THE SEAT HERE (docs/plans/workspace-status.md D12). The team is reach, so
 * a root who works here through a membership has one only while that seat is
 * LIVE: a manager this workspace deactivated or removed manages nobody here.
 * The people below are walked as people anchored here are: not removed
 * (deletedAt), a deactivated one kept. So a membership report is kept while
 * their seat here is (deactivated included, removedAt null), and a removed
 * one ends the walk, as a removed account does. Before, any membership row
 * counted, an ended one included.
 *
 * THE LINE HERE (docs/plans/workspace-status-2.md E1, step 2). Each step
 * down reads THIS workspace's lines: the people anchored here whose account
 * line names someone in the team, and the people here through a membership
 * whose membership line does. Before, the walk joined every account line,
 * so Max had Pat in B through her line in A, and Dana, who leads Pat in B,
 * did not. PostgreSQL allows one reference to the recursive name, so the
 * step joins `team t` to a LATERAL subquery of the two indexed halves:
 *
 *   anchored here       "User" by "User_managerId_idx", then the workspace
 *   a membership here   "OrganizationMembership" by
 *                       "OrganizationMembership_managerId_organizationId_idx"
 *                       (both columns), each person then by "User_pkey"
 *
 * The membership half leaves out the people anchored here, so the anchored
 * workspace's own stale membership row is never read as their line.
 */
export async function getTeamUserIds(
  organizationId: string,
  rootUserId: string,
  /** The root's Agent tier in this workspace when the caller knows it (the acting viewer's isAgent); read fresh when absent. */
  opts: { rootIsAgent?: boolean } = {},
): Promise<string[]> {
  const agentRoot = opts.rootIsAgent !== undefined ? Promise.resolve(opts.rootIsAgent) : managesNobody(rootUserId, organizationId);
  const [agent, rows] = await Promise.all([agentRoot, prisma.$queryRaw<{ id: string }[]>`
    WITH RECURSIVE team AS (
      SELECT id FROM "User"
      WHERE id = ${rootUserId}
        AND "deletedAt" IS NULL
        AND ("organizationId" = ${organizationId}
             OR EXISTS (SELECT 1 FROM "OrganizationMembership" m
                         WHERE m."userId" = ${rootUserId} AND m."organizationId" = ${organizationId} AND ${liveSeatSql("m")}))
      UNION
      SELECT r.id FROM team t
      CROSS JOIN LATERAL (
        SELECT u.id FROM "User" u
         WHERE u."managerId" = t.id AND u."organizationId" = ${organizationId} AND u."deletedAt" IS NULL
        UNION ALL
        SELECT m."userId" AS id FROM "OrganizationMembership" m
          JOIN "User" u ON u.id = m."userId"
         WHERE m."managerId" = t.id AND m."organizationId" = ${organizationId} AND ${keptSeatSql("m")}
           AND u."organizationId" <> ${organizationId} AND u."deletedAt" IS NULL
      ) r
    )
    SELECT id FROM team
  `]);
  return rows.map((r) => r.id).filter((id) => !agent || id === rootUserId);
}
