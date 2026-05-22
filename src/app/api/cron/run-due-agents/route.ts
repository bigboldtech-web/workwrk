// POST /api/cron/run-due-agents
//
// Cron-tickable endpoint — call this from Vercel Cron, a server cron,
// or any scheduler. Walks every agent that has:
//   - status = ENABLED
//   - autonomousEnabled = true
//   - scheduleCron set
//   - nextRunAt <= now (or null, meaning "first run")
// and fires `runAgentAutonomously` on each. Results are persisted as
// AgentRun rows.
//
// Auth: this endpoint is meant to be called by external schedulers,
// so we accept a shared secret via `Authorization: Bearer <secret>`
// (env var `CRON_SECRET`). When the secret isn't set, only authed
// admins can call it — so local dev works without extra setup.

import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import { runAgentAutonomously } from "@/lib/agents/autonomous";

const ADMIN_LEVELS = new Set(["SUPER_ADMIN", "COMPANY_ADMIN"]);

async function authorize(req: Request): Promise<{ ok: true } | { ok: false; status: number; error: string }> {
  const secret = process.env.CRON_SECRET;
  if (secret) {
    // Match the convention the rest of the WorkwrK cron endpoints use
    // (see scripts/CRON-SETUP.md): a shared `x-cron-secret` header.
    // Bearer is accepted as a fallback so the same endpoint also works
    // under Vercel Cron, which sends `Authorization: Bearer <secret>`.
    const cronHeader = req.headers.get("x-cron-secret") ?? "";
    const bearer = req.headers.get("authorization") ?? "";
    if (cronHeader === secret || bearer === `Bearer ${secret}`) return { ok: true };
    // Fall through to session auth if neither header matched.
  }
  const session = await getServerSession(authOptions);
  if (!session?.user) return { ok: false, status: 401, error: "Unauthorized" };
  const accessLevel = (session.user as { accessLevel?: string }).accessLevel ?? "EMPLOYEE";
  if (!ADMIN_LEVELS.has(accessLevel)) {
    return { ok: false, status: 403, error: "Admin only" };
  }
  return { ok: true };
}

export async function POST(req: Request) {
  const auth = await authorize(req);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  const now = new Date();
  const due = await prisma.agent.findMany({
    where: {
      status: "ENABLED",
      autonomousEnabled: true,
      scheduleCron: { not: null },
      OR: [
        { nextRunAt: null }, // never run before
        { nextRunAt: { lte: now } },
      ],
    },
    select: { id: true, slug: true, name: true, organizationId: true },
    // Cap how many we fire per tick so a backlog doesn't run away.
    take: 50,
  });

  const fired: Array<{ agentSlug: string; status: string; runId?: string; error?: string }> = [];
  for (const agent of due) {
    try {
      const result = await runAgentAutonomously({
        agentId: agent.id,
        trigger: "SCHEDULED",
        triggeredBy: null,
      });
      fired.push({
        agentSlug: agent.slug,
        status: result.status,
        runId: result.runId,
        error: result.errorText,
      });
    } catch (err) {
      fired.push({
        agentSlug: agent.slug,
        status: "FAILED",
        error: err instanceof Error ? err.message : "Unknown error",
      });
    }
  }

  return NextResponse.json({
    firedCount: fired.length,
    runs: fired,
  });
}

// Vercel Cron sends GET, not POST — accept both so the same endpoint
// works under any scheduler.
export { POST as GET };
