// GET  /api/agents/teammates/[slug]/routines: this person's routines with the
//      teammate, never anyone else's (a routine runs as the person it is for).
// POST /api/agents/teammates/[slug]/routines { name, prompt, schedule }
//      Set one up from the settings (createRoutine): a schedule the
//      scheduler reads, at most once an hour, within ROUTINE_LIMITS. A bare
//      five-field cron is read in the person's own zone (CRON_TZ=).
//
// docs/plans/ai-teammates.md 3.9 and 4. Every refusal is { error, code }.

import { NextResponse } from "next/server";
import { z } from "zod";
import { requireApp } from "@/lib/app-gate";
import { prisma } from "@/lib/prisma";
import { personZone, resolveActingPerson } from "@/lib/agents/acting";
import { scheduleForSave } from "@/lib/agents/cron";
import { ROUTINE_LIMITS } from "@/lib/agents/routines";
import { createRoutine } from "@/lib/agents/routines-server";
import { ACTION_ERRORS, TEAMMATE_ROUTE_ERRORS, removedComposer } from "@/lib/agents/teammate-copy";
import { invalidRequest, loadTeammate, teammateError, teammateNotFound } from "@/lib/agents/teammate-server";
import { ROUTINE_VIEW_SELECT, routineViewFromRow } from "@/lib/agents/teammate-views";

type Params = { params: Promise<{ slug: string }> };

export async function GET(_req: Request, { params }: Params) {
  const gate = await requireApp("ai");
  if ("error" in gate) return gate.error;
  const { viewer } = gate;
  const { slug } = await params;
  const agent = await loadTeammate(slug, viewer, { includeRemoved: true });
  if (!agent) return teammateNotFound();
  const [rows, zone] = await Promise.all([
    prisma.agentRoutine.findMany({
      where: { organizationId: viewer.organizationId, agentId: agent.id, actingForId: viewer.userId },
      orderBy: { createdAt: "asc" },
      take: ROUTINE_LIMITS.perTeammate * 2,
      select: ROUTINE_VIEW_SELECT,
    }),
    personZone(viewer.userId, viewer.organizationId),
  ]);
  return NextResponse.json({ routines: rows.map((r) => routineViewFromRow(r, zone)) });
}

const postSchema = z.object({
  name: z.string().trim().min(1).max(ROUTINE_LIMITS.nameMax),
  prompt: z.string().trim().min(1).max(ROUTINE_LIMITS.promptMax),
  schedule: z.string().trim().min(1).max(120),
});

export async function POST(req: Request, { params }: Params) {
  const gate = await requireApp("ai");
  if ("error" in gate) return gate.error;
  const { viewer } = gate;
  const { slug } = await params;
  const agent = await loadTeammate(slug, viewer, { includeRemoved: true });
  if (!agent) return teammateNotFound();
  const parsed = postSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return invalidRequest();
  if (agent.status === "ARCHIVED") return teammateError(409, "agent_removed", removedComposer(agent.name));
  // Every run acts as this person, so they must be someone a teammate can
  // act for now; their zone is the one a picked time is read in.
  const acting = await resolveActingPerson(viewer.organizationId, viewer.userId);
  if (!acting.ok) return teammateError(403, "person_cannot", ACTION_ERRORS.personCannot);
  const zone = acting.person.timezone;

  const made = await createRoutine({
    organizationId: viewer.organizationId,
    agentId: agent.id,
    actingForId: viewer.userId,
    name: parsed.data.name,
    prompt: parsed.data.prompt,
    schedule: scheduleForSave(parsed.data.schedule.replace(/\s+/g, " "), zone),
    createdVia: "settings",
    zone,
  });
  if (!made.ok) return teammateError(400, made.code, made.message);
  const row = await prisma.agentRoutine.findFirst({ where: { id: made.routine.id }, select: ROUTINE_VIEW_SELECT });
  // Deleted from another tab a moment after it was made.
  if (!row) return teammateError(404, "not_found", TEAMMATE_ROUTE_ERRORS.routineNotFound);
  return NextResponse.json({ routine: routineViewFromRow(row, zone) }, { status: 201 });
}
