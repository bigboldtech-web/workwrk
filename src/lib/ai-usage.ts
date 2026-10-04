// The daily guard rail on AI cost (Batch 8): one row per workspace, UTC day
// and kind in "AiUsageDay" (prisma/sql/2026-10-04-ai-fields-and-updates.sql).
//
// claimAiUse adds one use and answers whether it fitted under the cap, in ONE
// statement: the upsert only increments while the count is below the cap, so
// two requests at the same moment can never both take the last use, and no
// read-then-write window exists. A provider failure gives its use back
// (releaseAiUse), so an outage never spends a workspace's day.
//
// Fails closed: a database without the table (the SQL file not applied yet)
// answers "not_ready", and the caller sends nothing to the AI provider.
//
// Server-only: imports prisma.

import { prisma } from "@/lib/prisma";

export type AiUseKind = "field_fill" | "talk_update";

export type AiUseClaim = "ok" | "limit" | "not_ready";

export async function claimAiUse(organizationId: string, kind: AiUseKind, cap: number): Promise<AiUseClaim> {
  if (!Number.isFinite(cap) || cap <= 0) return "limit";
  try {
    const rows = await prisma.$queryRaw<Array<{ count: number }>>`
      INSERT INTO "AiUsageDay" ("organizationId", "day", "kind", "count", "updatedAt")
      VALUES (${organizationId}, (now() AT TIME ZONE 'UTC')::date, ${kind}, 1, now() AT TIME ZONE 'UTC')
      ON CONFLICT ("organizationId", "day", "kind")
      DO UPDATE SET "count" = "AiUsageDay"."count" + 1, "updatedAt" = now() AT TIME ZONE 'UTC'
      WHERE "AiUsageDay"."count" < ${Math.floor(cap)}
      RETURNING "count"`;
    return rows.length > 0 ? "ok" : "limit";
  } catch (err) {
    console.error(`[ai-usage] claim failed: ${err instanceof Error ? err.message.split("\n").pop() : String(err)}`);
    return "not_ready";
  }
}

/** Give one use back after the provider failed before answering. Never throws. */
export async function releaseAiUse(organizationId: string, kind: AiUseKind): Promise<void> {
  try {
    await prisma.$executeRaw`
      UPDATE "AiUsageDay" SET "count" = "count" - 1, "updatedAt" = now() AT TIME ZONE 'UTC'
      WHERE "organizationId" = ${organizationId}
        AND "day" = (now() AT TIME ZONE 'UTC')::date
        AND "kind" = ${kind}
        AND "count" > 0`;
  } catch {
    // A use not given back costs one use of the day, never anything more.
  }
}
