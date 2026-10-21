// Each connection's daily counts and the daily caps (docs/plans/mcp-server.md
// 2.5 step 5, 3.10, 5.4, 6.3).
//
// One McpUsageDay row per grant and UTC day: tools/call answered (`calls`),
// changes made (`writes`, step 3) and calls that answered a refusal
// (`refused`). Owners and Admins see the sums; the rows hold counts only,
// never what was asked or read. A connection may make 5,000 tools/call and
// 1,000 changes a UTC day; past them a call answers dailyCap, counted as
// refused and not as a call.
//
// A count that cannot be written never fails the call (a missing table, a
// blip): the caps are a safety line, and one lost increment is a smaller
// harm than refusing a person their own work. It is logged by code.
//
// Server-only.

import { prisma } from "@/lib/prisma";

export const CALLS_PER_DAY = 5_000;
export const WRITES_PER_DAY = 1_000;

/** The grant a count belongs to. */
export interface UsageGrant {
  id: string;
  organizationId: string;
  clientId: string;
  userId: string;
}

/** The UTC day of a moment, "YYYY-MM-DD". */
export function utcDay(now: Date = new Date()): string {
  return now.toISOString().slice(0, 10);
}

/** Today's counts for one grant (zero when there is no row). */
export async function dayUsage(grantId: string, now: Date = new Date()): Promise<{ calls: number; writes: number; refused: number }> {
  const row = await prisma.mcpUsageDay
    .findUnique({ where: { grantId_day: { grantId, day: utcDay(now) } }, select: { calls: true, writes: true, refused: true } })
    .catch(() => null);
  return { calls: row?.calls ?? 0, writes: row?.writes ?? 0, refused: row?.refused ?? 0 };
}

/** Has this grant used today's calls (or, for a write, today's changes)? */
export async function dayCapReached(grantId: string, kind: { write: boolean }, now: Date = new Date()): Promise<boolean> {
  const u = await dayUsage(grantId, now);
  return u.calls >= CALLS_PER_DAY || (kind.write && u.writes >= WRITES_PER_DAY);
}

async function bump(g: UsageGrant, field: "calls" | "writes" | "refused", now: Date, by = 1): Promise<void> {
  if (by <= 0) return;
  const day = utcDay(now);
  try {
    await prisma.mcpUsageDay.upsert({
      where: { grantId_day: { grantId: g.id, day } },
      create: {
        grantId: g.id,
        day,
        organizationId: g.organizationId,
        clientId: g.clientId,
        userId: g.userId,
        calls: field === "calls" ? by : 0,
        writes: field === "writes" ? by : 0,
        refused: field === "refused" ? by : 0,
      },
      update: field === "calls" ? { calls: { increment: by } } : field === "writes" ? { writes: { increment: by } } : { refused: { increment: by } },
    });
  } catch {
    console.warn(`[mcp] usage not_written`);
  }
}

/** One tools/call counted. */
export function countCall(g: UsageGrant, now: Date = new Date()): Promise<void> {
  return bump(g, "calls", now);
}

/** Changes counted: one per write call, and one more for each subtask a create made. */
export function countWrite(g: UsageGrant, now: Date = new Date(), changes = 1): Promise<void> {
  return bump(g, "writes", now, changes);
}

/** One call that answered a refusal. */
export function countRefused(g: UsageGrant, now: Date = new Date()): Promise<void> {
  return bump(g, "refused", now);
}
