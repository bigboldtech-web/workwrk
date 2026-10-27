// /api/users/[id]/agent-reports: an Agent who still has people listed as
// reporting to them (docs-found fixes batch 3).
//
// An Agent is never anyone's manager (AGENT_TIER_BLURB). Rule 6 stops a
// manager becoming an Agent while anyone reports to them, but lines stored
// before it can still name an Agent. Every read that grants reach already
// treats such an Agent as no one's manager (src/lib/access/manager-lines.ts),
// so nothing is rewritten on its own. This is the Admin's way to make the
// stored record match, from the Members drawer:
//
//   GET   what is stored (direct and dotted-line reports) and where "Move
//         their reports" sends the direct reports, by name
//   POST  move them, under the workspace's role lock: the direct reports up
//         the Agent's line to the first person who can manage them (the
//         handover's own routing, handover.server.ts moveAgentReports),
//         else to no manager; the dotted lines to the Agent taken off.
//         Logged, and open review cycles follow the new lines. With
//         { expect } (the plan GET answered, which the drawer showed), the
//         move runs only if the plan under the lock is still that plan,
//         else 409 plan_changed and nothing moves. A busy lock is a 503.
//   Both name the people whose line to the Agent another workspace relies
//   on (`stays`): they also work with the Agent there, where the Agent is no
//   Agent, so that line is that workspace's too and stays (batch 6).
//
// For Owners, Admins and the People team: the people who write Reports to.

import { NextResponse, type NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { logActivity } from "@/lib/activity";
import { isPeopleAdmin, peopleCtx } from "@/lib/people/person-access.server";
import { staleTabRefusal } from "@/lib/access/tab-workspace-check";
import { moveAgentReports, previewAgentReports, type AgentReportsPlan } from "@/lib/people/handover.server";
import { rolesBusyResponse } from "@/lib/access/roles-busy";
import { inWorkspaceWhere } from "@/lib/access/acting-workspace";

const err = (status: number, error: string, extra: Record<string, unknown> = {}) => NextResponse.json({ error, ...extra }, { status });

type Gate =
  | { ok: false; error: NextResponse }
  | { ok: true; ctx: NonNullable<Awaited<ReturnType<typeof peopleCtx>>>; person: { id: string; firstName: string | null; lastName: string | null } };

async function gate(id: string): Promise<Gate> {
  const ctx = await peopleCtx();
  if (!ctx) return { ok: false, error: err(401, "Unauthorized") };
  // A tab still showing another workspace than the session's: refused, never written here (src/lib/access/tab-workspace-check.ts).
  const staleTab = await staleTabRefusal(ctx.organizationId);
  if (staleTab) return { ok: false, error: staleTab };
  if (!isPeopleAdmin(ctx)) return { ok: false, error: err(403, "Only Owners, Admins and the People team move someone's reports.") };
  // Anyone who works here, anchored here or through a membership here
  // (docs-found fixes batch 5): the move writes only their reports' lines,
  // never their own row, and an Agent who last switched to another
  // workspace still has people listed under them here. By id first
  // ("User_pkey"), so inWorkspaceWhere is safe here (batch 6).
  const person = await prisma.user.findFirst({
    where: { id, deletedAt: null, ...inWorkspaceWhere(ctx.organizationId) },
    select: { id: true, firstName: true, lastName: true },
  });
  if (!person) return { ok: false, error: err(404, "Not found") };
  return { ok: true, ctx, person };
}

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const g = await gate(id);
  if (!g.ok) return g.error;
  return NextResponse.json(await previewAgentReports(g.ctx.organizationId, id), { headers: { "Cache-Control": "no-store" } });
}

/** The plan the caller was shown, when it sent one: the counts and where the direct reports go, by id. */
function expectedPlan(body: unknown): Pick<AgentReportsPlan, "solid" | "dotted" | "rehomed"> | null {
  const e = (body as { expect?: unknown } | null)?.expect as Partial<AgentReportsPlan> | undefined;
  if (!e || typeof e !== "object" || typeof e.solid !== "number" || typeof e.dotted !== "number" || !Array.isArray(e.rehomed)) return null;
  const rehomed = e.rehomed
    .filter((r): r is AgentReportsPlan["rehomed"][number] => !!r && typeof r === "object" && typeof (r as { count?: unknown }).count === "number")
    .map((r) => ({ to: null, toId: typeof r.toId === "string" ? r.toId : null, count: r.count }));
  return { solid: e.solid, dotted: e.dotted, rehomed };
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const g = await gate(id);
  if (!g.ok) return g.error;
  const expect = expectedPlan(await req.json().catch(() => null));
  let done: Awaited<ReturnType<typeof moveAgentReports>>;
  try {
    done = await moveAgentReports({ organizationId: g.ctx.organizationId, agentId: id, actorId: g.ctx.userId, expect });
  } catch (e) {
    const busy = rolesBusyResponse(e);
    if (busy) return busy;
    throw e;
  }
  if (!done) return err(409, "They aren't on the Agent tier, so their reports stay with them.", { code: "not_agent" });
  if ("changed" in done) {
    return err(409, "Their reports changed since this was shown, so nothing moved. Check where they go now and try again.", { code: "plan_changed" });
  }
  const name = `${g.person.firstName ?? ""} ${g.person.lastName ?? ""}`.trim();
  if (done.moved + done.dottedRemoved > 0) {
    const where = done.rehomed
      .filter((r) => r.count > 0)
      .map((r) => `${r.count} to ${r.to ?? "no manager"}`)
      .join(", ");
    // Lines another workspace relies on stay (batch 6), and the log says so.
    const stays = done.stays.length
      ? `. ${done.stays.length} ${done.stays.length === 1 ? "line stays" : "lines stay"}: another workspace they work in relies on ${done.stays.length === 1 ? "it" : "them"}`
      : "";
    void logActivity({
      type: "reporting_line_changed",
      actorId: g.ctx.userId,
      organizationId: g.ctx.organizationId,
      description: `Moved the reports listed under ${name}, who is on the Agent tier: ${done.moved} direct ${done.moved === 1 ? "report" : "reports"}${where ? ` (${where})` : ""}, and ${done.dottedRemoved} dotted ${done.dottedRemoved === 1 ? "line" : "lines"} taken off${stays}`,
      targetId: id,
      targetType: "user",
      metadata: { agentReports: true, moved: done.moved, dottedRemoved: done.dottedRemoved, staying: done.stays.length, rehomed: done.rehomed.map((r) => ({ managerId: r.toId, count: r.count })) },
    });
  }
  return NextResponse.json(done);
}
