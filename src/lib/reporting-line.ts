// Reporting-line helpers — solid managerId chain (existing User self-
// relation) plus dotted-line managers (UserDottedLine). The Phase 6
// access resolver leans on these to scope "what this manager sees."
//
// All depth-walks use a Postgres recursive CTE via $queryRaw so we
// don't N+1 at Fortune-500 scale. Falls back to a bounded iterative
// fetch for non-Postgres environments — currently we're 100% Postgres
// (Neon) so the CTE path is canonical.

// An Agent is never anyone's manager (AGENT_TIER_BLURB). Lines stored before
// rule 6 still name some Agents as managers, so every walk here reads them as
// the sentence says (src/lib/access/manager-lines.ts): rooted at an Agent, a
// walk finds nobody below; an Agent further down a manager's tree is passed
// through as before, so their reports stay in reach of the manager above.

import { prisma } from "@/lib/prisma";
import { effectiveDirectReportIds, managesNobody } from "@/lib/access/manager-lines";

const DEFAULT_MAX_DEPTH = 6;

export interface ReportNode {
  userId: string;
  depth: number;
  via: "solid" | "dotted";
  weight?: number;     // populated on dotted lines (1.0 if unset)
}

/**
 * Direct solid reports (one level only), as an Agent-free line reads them:
 * nobody for an Agent, and the people listed under an Agent among the
 * reports count as direct reports of this manager (manager-lines.ts).
 */
export async function getSolidReports(managerId: string): Promise<string[]> {
  const head = await prisma.user.findUnique({ where: { id: managerId }, select: { organizationId: true } });
  if (!head) return [];
  return effectiveDirectReportIds(head.organizationId, managerId);
}

/** Direct dotted reports (one level only). Nobody's for an Agent: their dotted lines count for nobody. */
export async function getDottedReports(managerId: string): Promise<Array<{ userId: string; weight: number | null }>> {
  if (await managesNobody(managerId)) return [];
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
 * Rooted at an Agent it finds nobody below (the root alone, when asked).
 */
export async function getSolidReportTree(
  rootUserId: string,
  opts: { maxDepth?: number; includeRoot?: boolean } = {},
): Promise<string[]> {
  const [agent, ids] = await Promise.all([managesNobody(rootUserId), solidTreeRows(rootUserId, opts)]);
  return agent ? ids.filter((id) => id === rootUserId) : ids;
}

async function solidTreeRows(rootUserId: string, opts: { maxDepth?: number; includeRoot?: boolean }): Promise<string[]> {
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
 * Rooted at an Agent: the root alone (no solid tree, no dotted reports).
 */
export async function getEffectiveReportTree(
  rootUserId: string,
  opts: { maxDepth?: number } = {},
): Promise<string[]> {
  const [agent, solidRows, dotted] = await Promise.all([
    managesNobody(rootUserId),
    solidTreeRows(rootUserId, opts),
    prisma.userDottedLine.findMany({
      where: { managerId: rootUserId },
      select: { userId: true },
    }),
  ]);
  if (agent) return solidRows.filter((id) => id === rootUserId);
  const solid = solidRows;
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
