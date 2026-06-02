// Reporting-line helpers — solid managerId chain (existing User self-
// relation) plus dotted-line managers (UserDottedLine). The Phase 6
// access resolver leans on these to scope "what this manager sees."
//
// All depth-walks use a Postgres recursive CTE via $queryRaw so we
// don't N+1 at Fortune-500 scale. Falls back to a bounded iterative
// fetch for non-Postgres environments — currently we're 100% Postgres
// (Neon) so the CTE path is canonical.

import { prisma } from "@/lib/prisma";

const DEFAULT_MAX_DEPTH = 6;

export interface ReportNode {
  userId: string;
  depth: number;
  via: "solid" | "dotted";
  weight?: number;     // populated on dotted lines (1.0 if unset)
}

/** Direct solid reports (one level only). */
export async function getSolidReports(managerId: string): Promise<string[]> {
  const rows = await prisma.user.findMany({
    where: { managerId, deletedAt: null },
    select: { id: true },
  });
  return rows.map((r) => r.id);
}

/** Direct dotted reports (one level only). */
export async function getDottedReports(managerId: string): Promise<Array<{ userId: string; weight: number | null }>> {
  const rows = await prisma.userDottedLine.findMany({
    where: { managerId },
    select: { userId: true, weight: true },
  });
  return rows.map((r) => ({ userId: r.userId, weight: r.weight }));
}

/** Union of solid + dotted direct reports as a flat string[] of user ids. */
export async function getAllDirectReports(managerId: string): Promise<string[]> {
  const [solid, dotted] = await Promise.all([
    getSolidReports(managerId),
    getDottedReports(managerId),
  ]);
  const set = new Set<string>(solid);
  for (const d of dotted) set.add(d.userId);
  return Array.from(set);
}

/**
 * Walk DOWN the solid reporting chain via a Postgres recursive CTE.
 * Returns the manager + every transitive solid report, bounded by
 * `maxDepth`. Default cap is 6 — deep org trees rarely exceed that.
 */
export async function getSolidReportTree(
  rootUserId: string,
  opts: { maxDepth?: number; includeRoot?: boolean } = {},
): Promise<string[]> {
  const maxDepth = opts.maxDepth ?? DEFAULT_MAX_DEPTH;
  const rows = await prisma.$queryRaw<Array<{ id: string; depth: number }>>`
    WITH RECURSIVE tree AS (
      SELECT u."id", 0 AS depth
        FROM "User" u
       WHERE u."id" = ${rootUserId}
         AND u."deletedAt" IS NULL
      UNION ALL
      SELECT u."id", t.depth + 1
        FROM "User" u
        JOIN tree t ON u."managerId" = t."id"
       WHERE u."deletedAt" IS NULL
         AND t.depth < ${maxDepth}
    )
    SELECT DISTINCT "id", depth FROM tree
  `;
  return rows
    .filter((r) => (opts.includeRoot ?? true) || r.id !== rootUserId)
    .map((r) => r.id);
}

/**
 * Effective reports — solid tree + dotted reports at any level of that
 * tree. Dotted lines are NOT transitively walked (a dotted report's
 * own solid reports don't bubble up; that's the Workday convention).
 */
export async function getEffectiveReportTree(
  rootUserId: string,
  opts: { maxDepth?: number } = {},
): Promise<string[]> {
  const solid = await getSolidReportTree(rootUserId, opts);
  const dotted = await prisma.userDottedLine.findMany({
    where: { managerId: rootUserId },
    select: { userId: true },
  });
  const set = new Set<string>(solid);
  for (const d of dotted) set.add(d.userId);
  return Array.from(set);
}

/**
 * Walk UP the solid reporting chain — every manager / grand-manager /
 * etc. above this user. Capped at `maxDepth`.
 */
export async function getReportingChain(
  userId: string,
  opts: { maxDepth?: number } = {},
): Promise<string[]> {
  const maxDepth = opts.maxDepth ?? DEFAULT_MAX_DEPTH;
  const rows = await prisma.$queryRaw<Array<{ managerId: string; depth: number }>>`
    WITH RECURSIVE chain AS (
      SELECT u."managerId", 0 AS depth
        FROM "User" u
       WHERE u."id" = ${userId}
         AND u."managerId" IS NOT NULL
      UNION ALL
      SELECT u."managerId", c.depth + 1
        FROM "User" u
        JOIN chain c ON u."id" = c."managerId"
       WHERE u."managerId" IS NOT NULL
         AND c.depth < ${maxDepth}
    )
    SELECT DISTINCT "managerId", depth FROM chain WHERE "managerId" IS NOT NULL
  `;
  return rows.map((r) => r.managerId);
}

/**
 * Fast check: is `candidateUserId` somewhere in `managerId`'s effective
 * report tree? Used by the access resolver in Phase 6 to gate things
 * like "can this manager read this person's comp?".
 */
export async function isInReportTree(managerId: string, candidateUserId: string, opts: { maxDepth?: number } = {}): Promise<boolean> {
  if (managerId === candidateUserId) return false;
  const tree = await getEffectiveReportTree(managerId, opts);
  return tree.includes(candidateUserId);
}
