// GET /api/automation/health
//
// Health aggregates for the hub's Health page over a ?days=7|30|90 window
// or an exact ?from=&to= (default: the last 30 days). Returns run totals by status, the
// success rate over terminal runs (SUCCESS/FAILED/PARTIAL; SKIPPED and
// RUNNING are excluded), and failure counts by workflow severity.

import { NextResponse, type NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAutomation } from "@/lib/automation/gate";

const DEFAULT_WINDOW_MS = 30 * 86_400_000;

function parseDate(raw: string | null): Date | null | "invalid" {
  if (!raw) return null;
  const d = new Date(raw);
  return Number.isNaN(d.getTime()) ? "invalid" : d;
}

export async function GET(req: NextRequest) {
  const ctx = await requireAutomation();
  if ("error" in ctx) return ctx.error;

  const sp = req.nextUrl.searchParams;
  const fromRaw = parseDate(sp.get("from"));
  if (fromRaw === "invalid") return NextResponse.json({ error: "Invalid from date" }, { status: 400 });
  const toRaw = parseDate(sp.get("to"));
  if (toRaw === "invalid") return NextResponse.json({ error: "Invalid to date" }, { status: 400 });

  // ?days=7|30|90 is the Health page's window pills; an exact from wins.
  const daysRaw = Number.parseInt(sp.get("days") ?? "", 10);
  const windowMs = [7, 30, 90].includes(daysRaw) ? daysRaw * 86_400_000 : DEFAULT_WINDOW_MS;
  const to = toRaw ?? new Date();
  const from = fromRaw ?? new Date(to.getTime() - windowMs);
  if (from.getTime() > to.getTime()) {
    return NextResponse.json({ error: "from must be before to" }, { status: 400 });
  }

  const where = { organizationId: ctx.orgId, createdAt: { gte: from, lte: to } };

  const [byStatusRows, failureRows] = await Promise.all([
    prisma.automationRun.groupBy({
      by: ["status"],
      where,
      _count: { _all: true },
    }),
    prisma.automationRun.groupBy({
      by: ["severity"],
      where: { ...where, status: "FAILED" },
      _count: { _all: true },
    }),
  ]);

  const byStatus: Record<string, number> = {
    RUNNING: 0,
    SUCCESS: 0,
    FAILED: 0,
    PARTIAL: 0,
    SKIPPED: 0,
  };
  for (const row of byStatusRows) byStatus[row.status] = row._count._all;

  const failuresBySeverity: Record<string, number> = { CRITICAL: 0, MAJOR: 0, MINOR: 0 };
  for (const row of failureRows) failuresBySeverity[row.severity] = row._count._all;

  const total = Object.values(byStatus).reduce((a, b) => a + b, 0);
  const terminal = byStatus.SUCCESS + byStatus.FAILED + byStatus.PARTIAL;
  const successRate = terminal > 0 ? Math.round((byStatus.SUCCESS / terminal) * 1000) / 10 : null;

  return NextResponse.json({
    window: { from: from.toISOString(), to: to.toISOString() },
    totals: { total, byStatus },
    successRate,
    failuresBySeverity,
  });
}
