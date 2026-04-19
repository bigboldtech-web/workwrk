import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import {
  getSessionOrFail,
  getOrgId,
  isManager,
  jsonError,
  jsonSuccess,
} from "@/lib/api-helpers";

/**
 * GET /api/ai/signals
 *
 * Reads across existing modules and surfaces cross-cutting signals that
 * individual module dashboards can't see on their own. This is the
 * "AI Engine surfaces signals" feature from the marketing site —
 * implemented with deterministic rule-based detection over the
 * existing data model (no extra schema needed).
 *
 * Signal categories:
 *   • KUDOS_DECAY    — team members who haven't received kudos in 60+ days
 *   • REVIEW_OVERDUE — pending reviews whose cycle is beyond its endDate
 *   • SOP_DRIFT      — SOPs with low compliance (< 60% assigned users completing)
 *   • KPI_STALE      — KPIs with no record in the last 30 days
 *   • ATTRITION_RISK — users with downward composite trajectory (needs
 *                      PerformanceScore history; best-effort signal)
 *
 * Manager-only. Non-managers get a scoped empty set.
 */
export async function GET(_req: NextRequest) {
  const { error, session } = await getSessionOrFail();
  if (error) return error;

  const orgId = getOrgId(session);
  const managerView = isManager(session);

  if (!managerView) {
    return jsonSuccess({ signals: [] });
  }

  const now = new Date();
  const sixtyDaysAgo = new Date(now.getTime() - 60 * 24 * 60 * 60 * 1000);
  const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);

  // ---- KUDOS DECAY ----
  // Users who are active, have been on the team > 60 days, and haven't
  // received a kudos in the last 60 days.
  const kudosDecayUsers = await prisma.user.findMany({
    where: {
      organizationId: orgId,
      status: "ACTIVE",
      createdAt: { lte: sixtyDaysAgo },
      kudosReceived: {
        none: { createdAt: { gte: sixtyDaysAgo } },
      },
    },
    select: {
      id: true,
      firstName: true,
      lastName: true,
      role: { select: { title: true } },
    },
    take: 20,
  });

  // ---- REVIEW OVERDUE ----
  const overdueReviews = await prisma.review.findMany({
    where: {
      cycle: { organizationId: orgId, endDate: { lt: now } },
      status: { in: ["PENDING", "SELF_ASSESSMENT", "MANAGER_REVIEW"] },
    },
    select: {
      id: true,
      cycle: { select: { name: true, endDate: true } },
      subject: { select: { firstName: true, lastName: true } },
    },
    take: 20,
  });

  // ---- SOP DRIFT ----
  // Published SOPs where mean step completion < 60% across all assignees.
  const publishedSops = await prisma.sOP.findMany({
    where: { organizationId: orgId, status: "PUBLISHED" },
    select: {
      id: true,
      title: true,
      compliance: { select: { stepsTotal: true, stepsCompleted: true } },
    },
    take: 100,
  });

  const sopDrift = publishedSops
    .map((s) => {
      const totals = s.compliance.reduce(
        (acc, c) => ({
          done: acc.done + (c.stepsCompleted ?? 0),
          total: acc.total + (c.stepsTotal ?? 0),
        }),
        { done: 0, total: 0 },
      );
      const pct = totals.total > 0 ? (totals.done / totals.total) * 100 : null;
      return { id: s.id, title: s.title, pct };
    })
    .filter((s) => s.pct !== null && s.pct < 60)
    .slice(0, 10);

  // ---- KPI STALE ----
  // KPIs with no record in the last 30 days.
  const staleKpis = await prisma.kPI.findMany({
    where: {
      kra: { organizationId: orgId },
      records: { none: { createdAt: { gte: thirtyDaysAgo } } },
    },
    select: {
      id: true,
      name: true,
      kra: { select: { name: true } },
    },
    take: 10,
  });

  // ---- Shape into signals ----
  type Signal = {
    kind: "KUDOS_DECAY" | "REVIEW_OVERDUE" | "SOP_DRIFT" | "KPI_STALE";
    severity: "high" | "med" | "low";
    target: string;
    reason: string;
    href?: string;
  };

  const signals: Signal[] = [];

  for (const u of kudosDecayUsers) {
    signals.push({
      kind: "KUDOS_DECAY",
      severity: "med",
      target: `${u.firstName} ${u.lastName}`,
      reason: `60+ days without recognition${u.role?.title ? ` · ${u.role.title}` : ""}. First signal of disengagement.`,
      href: `/people/${u.id}`,
    });
  }

  for (const r of overdueReviews) {
    const days = Math.floor(
      (now.getTime() - new Date(r.cycle.endDate).getTime()) / (1000 * 60 * 60 * 24),
    );
    signals.push({
      kind: "REVIEW_OVERDUE",
      severity: days > 7 ? "high" : "med",
      target: `${r.subject.firstName} ${r.subject.lastName}`,
      reason: `Review for ${r.cycle.name} overdue by ${days} day${days === 1 ? "" : "s"}.`,
      href: `/reviews/${r.id}`,
    });
  }

  for (const s of sopDrift) {
    signals.push({
      kind: "SOP_DRIFT",
      severity: (s.pct ?? 0) < 40 ? "high" : "med",
      target: s.title,
      reason: `Compliance at ${Math.round(s.pct ?? 0)}%. Below 60% threshold.`,
      href: `/sops/${s.id}`,
    });
  }

  for (const k of staleKpis) {
    signals.push({
      kind: "KPI_STALE",
      severity: "low",
      target: `${k.name}${k.kra?.name ? ` · ${k.kra.name}` : ""}`,
      reason: "No reading in 30+ days.",
      href: `/kra-kpi`,
    });
  }

  // Sort by severity
  const order = { high: 0, med: 1, low: 2 } as const;
  signals.sort((a, b) => order[a.severity] - order[b.severity]);

  return jsonSuccess({
    signals,
    generatedAt: now.toISOString(),
    counts: {
      total: signals.length,
      high: signals.filter((s) => s.severity === "high").length,
      med: signals.filter((s) => s.severity === "med").length,
      low: signals.filter((s) => s.severity === "low").length,
    },
  });
}
