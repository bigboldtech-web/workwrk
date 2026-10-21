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

// ── The day's changes, reserved before a write runs (step 3 review, M1) ──
//
// Reading the day's count before a write and adding to it after let calls
// sent together all pass the read: at 999, ten creates with 25 subtasks each
// ended the day near 1,259. Now a write first RESERVES its changes in one
// conditional UPDATE (writes + n <= 1,000), which Postgres decides on the
// latest row for every call at once; what it did not use is given back after
// it ran. When the whole cost does not fit, what is left of the day is
// reserved instead, by a compare-and-swap on the count just read, so a create
// near the line still makes its task and as many subtasks as the day allows,
// and the day never goes past 1,000.
//
// A count that cannot be read or written never refuses the call (the rule
// at the top of this file): the reservation then answers the whole cost.

/**
 * Reserve up to `want` of today's changes for one write call; how many it
 * may make (0: the day is used up).
 */
export async function reserveWrites(g: UsageGrant, now: Date, want: number): Promise<number> {
  const day = utcDay(now);
  const key = { grantId: g.id, day };
  try {
    for (let attempt = 0; attempt < 4; attempt += 1) {
      const whole = await prisma.mcpUsageDay.updateMany({
        where: { ...key, writes: { lte: WRITES_PER_DAY - want } },
        data: { writes: { increment: want } },
      });
      if (whole.count === 1) return want;
      const row = await prisma.mcpUsageDay.findUnique({ where: { grantId_day: key }, select: { writes: true } });
      if (!row) {
        // No row yet (the call's own count could not be written): make it, then try again.
        await prisma.mcpUsageDay.upsert({
          where: { grantId_day: key },
          create: { grantId: g.id, day, organizationId: g.organizationId, clientId: g.clientId, userId: g.userId, calls: 0, writes: 0, refused: 0 },
          update: {},
        });
        continue;
      }
      const left = WRITES_PER_DAY - row.writes;
      if (left <= 0) return 0;
      const part = await prisma.mcpUsageDay.updateMany({ where: { ...key, writes: row.writes }, data: { writes: { increment: Math.min(left, want) } } });
      if (part.count === 1) return Math.min(left, want);
    }
    return 0;
  } catch {
    console.warn(`[mcp] usage not_written`);
    return want;
  }
}

/** Give back the reserved changes a call did not make. */
export async function releaseWrites(g: UsageGrant, now: Date, unused: number): Promise<void> {
  if (unused <= 0) return;
  try {
    await prisma.mcpUsageDay.updateMany({
      where: { grantId: g.id, day: utcDay(now), writes: { gte: unused } },
      data: { writes: { increment: -unused } },
    });
  } catch {
    console.warn(`[mcp] usage not_written`);
  }
}
