// "Somebody in that workspace did something": the one definition behind the
// Staff console's "Still active" (Retention) and "Busiest workspaces"
// (spec-admin-backoffice 2.5). Server only.
//
// A row counts as use only when
//   1. its type is not a lifecycle, sign-in, security, migration or staff row
//      (NOT_USE_TYPES and NOT_USE_PATTERNS in lib/admin/numbers.ts), and
//   2. it names a person as its actor, and that person belongs to the
//      workspace the row is in (their home workspace, or a membership), and
//   3. the workspace is not CANCELLED (by its Owner or by staff). A cancelled
//      company is churn, never retention: its last rows are still recent,
//      and without this it counted as Still active and Cancelled at once,
//      and ranked in Busiest workspaces.
// So signing up, deleting the workspace, switching away from a company, a
// person from another workspace, and anything WorkwrK staff do (those rows
// name no person, and their types are staff.*) never make a company look used.
//
// Each id list travels as ONE array parameter (never an IN list), so a year
// with any number of signups stays inside Postgres's bind-parameter limit.

import { prisma } from "@/lib/prisma";
import { NOT_USE_PATTERNS, NOT_USE_TYPES } from "@/lib/admin/numbers";

const TYPES = [...NOT_USE_TYPES];
const PATTERNS = [...NOT_USE_PATTERNS];

/** The top `take` companies by use since `since`, busiest first. */
export async function busiestByUse(since: Date, take = 12): Promise<{ organizationId: string; n: number }[]> {
  return prisma.$queryRaw<{ organizationId: string; n: number }[]>`
    SELECT a."organizationId" AS "organizationId", COUNT(*)::int AS n
    FROM "ActivityLog" a
    JOIN "Organization" o ON o."id" = a."organizationId"
    WHERE a."createdAt" >= ${since}
      AND o."status" <> 'CANCELLED'
      AND a."actorId" IS NOT NULL
      AND NOT (a."type" = ANY(${TYPES}::text[]))
      AND NOT (a."type" LIKE ANY(${PATTERNS}::text[]))
      AND (
        EXISTS (SELECT 1 FROM "User" u WHERE u."id" = a."actorId" AND u."organizationId" = a."organizationId")
        OR EXISTS (SELECT 1 FROM "OrganizationMembership" m WHERE m."userId" = a."actorId" AND m."organizationId" = a."organizationId")
      )
    GROUP BY a."organizationId"
    ORDER BY n DESC, a."organizationId" ASC
    LIMIT ${take}`;
}

/** Ids of the companies created on or after `createdFrom` that somebody in them used since `since`. */
export async function usedCompanyIds(since: Date, createdFrom: Date): Promise<string[]> {
  const rows = await prisma.$queryRaw<{ organizationId: string }[]>`
    SELECT DISTINCT a."organizationId" AS "organizationId"
    FROM "ActivityLog" a
    JOIN "Organization" o ON o."id" = a."organizationId"
    WHERE o."createdAt" >= ${createdFrom}
      AND o."status" <> 'CANCELLED'
      AND a."createdAt" >= ${since}
      AND a."actorId" IS NOT NULL
      AND NOT (a."type" = ANY(${TYPES}::text[]))
      AND NOT (a."type" LIKE ANY(${PATTERNS}::text[]))
      AND (
        EXISTS (SELECT 1 FROM "User" u WHERE u."id" = a."actorId" AND u."organizationId" = a."organizationId")
        OR EXISTS (SELECT 1 FROM "OrganizationMembership" m WHERE m."userId" = a."actorId" AND m."organizationId" = a."organizationId")
      )`;
  return rows.map((r) => r.organizationId);
}
