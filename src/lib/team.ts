import { prisma } from "@/lib/prisma";

/**
 * Returns the set of user IDs in `rootUserId`'s team — self + all direct and
 * indirect reports — scoped to `organizationId`. Uses a recursive CTE so the
 * walk happens in the database (indexed on `managerId`) instead of fetching
 * every org user and walking the tree in Node. Scales to thousands of users.
 */
export async function getTeamUserIds(
  organizationId: string,
  rootUserId: string,
): Promise<string[]> {
  const rows = await prisma.$queryRaw<{ id: string }[]>`
    WITH RECURSIVE team AS (
      SELECT id FROM "User"
      WHERE id = ${rootUserId}
        AND "organizationId" = ${organizationId}
        AND "deletedAt" IS NULL
      UNION
      SELECT u.id FROM "User" u
      INNER JOIN team t ON u."managerId" = t.id
      WHERE u."organizationId" = ${organizationId}
        AND u."deletedAt" IS NULL
    )
    SELECT id FROM team
  `;
  return rows.map((r) => r.id);
}
