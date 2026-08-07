// GET /api/automation/runs
//
// Execution log list, newest first. Filters: ?workflowId= &status=
// (comma-separated AutomationRunStatus values) &from= &to= (ISO dates on
// createdAt) &take= (default 50, hard cap 100). Payloads are omitted
// here; the run detail endpoint returns them with steps.

import { NextResponse, type NextRequest } from "next/server";
import type { Prisma } from "@/generated/prisma";
import { prisma } from "@/lib/prisma";
import { resolveAutomationContext } from "@/lib/automation/hub-access";

const RUN_STATUSES = ["RUNNING", "SUCCESS", "FAILED", "PARTIAL", "SKIPPED"] as const;
type RunStatus = (typeof RUN_STATUSES)[number];

const MAX_TAKE = 100;
const DEFAULT_TAKE = 50;

function parseDate(raw: string | null): Date | null | "invalid" {
  if (!raw) return null;
  const d = new Date(raw);
  return Number.isNaN(d.getTime()) ? "invalid" : d;
}

export async function GET(req: NextRequest) {
  const ctx = await resolveAutomationContext();
  if ("error" in ctx) return ctx.error;

  const sp = req.nextUrl.searchParams;

  const statuses = (sp.get("status") ?? "")
    .split(",")
    .map((s) => s.trim().toUpperCase())
    .filter(Boolean);
  for (const s of statuses) {
    if (!RUN_STATUSES.includes(s as RunStatus)) {
      return NextResponse.json({ error: `Invalid status: ${s}` }, { status: 400 });
    }
  }

  const from = parseDate(sp.get("from"));
  if (from === "invalid") return NextResponse.json({ error: "Invalid from date" }, { status: 400 });
  const to = parseDate(sp.get("to"));
  if (to === "invalid") return NextResponse.json({ error: "Invalid to date" }, { status: 400 });

  const takeRaw = Number.parseInt(sp.get("take") ?? "", 10);
  const take = Number.isFinite(takeRaw) ? Math.min(Math.max(takeRaw, 1), MAX_TAKE) : DEFAULT_TAKE;

  const workflowId = sp.get("workflowId")?.trim() || null;

  const where: Prisma.AutomationRunWhereInput = {
    organizationId: ctx.orgId,
    ...(workflowId ? { workflowId } : {}),
    ...(statuses.length ? { status: { in: statuses as RunStatus[] } } : {}),
    ...(from || to
      ? { createdAt: { ...(from ? { gte: from } : {}), ...(to ? { lte: to } : {}) } }
      : {}),
  };

  const runs = await prisma.automationRun.findMany({
    where,
    orderBy: { createdAt: "desc" },
    take,
    select: {
      id: true,
      workflowId: true,
      workflow: { select: { id: true, name: true } },
      workflowVersionId: true,
      triggerEventKey: true,
      status: true,
      severity: true,
      recordType: true,
      recordId: true,
      userId: true,
      errorMessage: true,
      startedAt: true,
      completedAt: true,
      durationMs: true,
      createdAt: true,
    },
  });

  return NextResponse.json({ runs, take });
}
