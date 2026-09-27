// /api/candor: candor sessions (spec-teams-performance /candor).
//
// GET  ?view=answer (default) | sessions | closed
//        answer    the Open sessions the viewer is in scope for, each with
//                  hasResponded; never an answer count (a respondent must
//                  never infer who answered)
//        sessions  Draft and Open sessions the viewer runs (the People team
//                  and Admin: every session), with the answer count
//        closed    the same for Closed sessions
//      A viewer who runs no sessions asking for sessions or closed gets the
//      answer view back, flagged `downgraded`, so the page can say why.
// POST { title, description?, prompts, departmentId?, status? }: a new
//      session, a Draft unless status is ACTIVE (launch at once). Every
//      prompt gets a stable id here (lib/performance/candor.ts).
// PATCH { id, ... }: kept for one release; the same rules as PATCH
//      /api/candor/[id].

import { NextRequest } from "next/server";
import { Prisma } from "@/generated/prisma";
import { prisma } from "@/lib/prisma";
import { getSessionOrFail, getOrgId, getUserId, jsonError, jsonSuccess } from "@/lib/api-helpers";
import { cultureOrganiserFromSession } from "@/lib/people/culture-gate";
import { candorCtx, notifyCandorOpen } from "@/lib/performance/candor.server";
import { normalizeCandorPrompts } from "@/lib/performance/candor";
import { PATCH as patchOne } from "./[id]/route";

export async function GET(req: NextRequest) {
  const { error, session } = await getSessionOrFail();
  if (error) return error;
  const ctx = await candorCtx();
  if (!ctx) return jsonError("Not found", 404);

  const orgId = getOrgId(session);
  const userId = getUserId(session);
  const runs = await cultureOrganiserFromSession(session, "candor");
  const asked = new URL(req.url).searchParams.get("view");
  const downgraded = (asked === "sessions" || asked === "closed") && !runs;
  const view = downgraded ? "answer" : asked === "sessions" || asked === "closed" ? asked : "answer";

  let where: Prisma.CandorSessionWhereInput;
  if (view === "answer") {
    const scope: Prisma.CandorSessionWhereInput[] = [{ departmentId: null }];
    if (ctx.departmentId) scope.push({ departmentId: ctx.departmentId });
    where = { organizationId: orgId, status: "ACTIVE", createdBy: { not: userId }, OR: scope };
  } else {
    where = {
      organizationId: orgId,
      status: view === "closed" ? "CLOSED" : { in: ["DRAFT", "ACTIVE"] },
      ...(ctx.peopleTeamOrAdmin ? {} : { createdBy: userId }),
    };
  }

  const sessions = await prisma.candorSession.findMany({
    where,
    include: { _count: { select: { responses: true } } },
    orderBy: view === "closed" ? { closedAt: "desc" } : { createdAt: "desc" },
  });

  // WHO answered (never what) lives in CandorRespondent; a database without
  // the table yet answers "not answered".
  let answered = new Set<string>();
  try {
    const rows = await prisma.candorRespondent.findMany({ where: { userId, sessionId: { in: sessions.map((s) => s.id) } }, select: { sessionId: true } });
    answered = new Set(rows.map((r) => r.sessionId));
  } catch (e) {
    if ((e as { code?: string })?.code !== "P2021") throw e;
  }
  const deptIds = [...new Set(sessions.map((s) => s.departmentId).filter((x): x is string => !!x))];
  const depts = deptIds.length ? await prisma.department.findMany({ where: { id: { in: deptIds }, organizationId: orgId }, select: { id: true, name: true } }) : [];
  const deptName = new Map(depts.map((d) => [d.id, d.name] as const));

  const data = sessions.map((s) => {
    const { _count, ...rest } = s;
    return {
      ...rest,
      prompts: normalizeCandorPrompts(s.prompts),
      department: s.departmentId ? { id: s.departmentId, name: deptName.get(s.departmentId) ?? "A department" } : null,
      isOwner: s.createdBy === userId,
      hasResponded: answered.has(s.id),
      ...(view === "answer" ? {} : { responseCount: _count.responses }),
    };
  });
  return jsonSuccess({ data, view, downgraded, canRun: runs, total: data.length });
}

export async function POST(req: NextRequest) {
  const { error, session } = await getSessionOrFail();
  if (error) return error;
  if (!(await cultureOrganiserFromSession(session, "candor"))) return jsonError("Only managers, the People team and Admins can create Candor sessions", 403);

  const orgId = getOrgId(session);
  const userId = getUserId(session);
  const body = ((await req.json().catch(() => null)) ?? {}) as Record<string, unknown>;
  const title = typeof body.title === "string" ? body.title.trim().slice(0, 200) : "";
  if (!title) return jsonError("Title is required");
  const prompts = normalizeCandorPrompts(body.prompts).filter((p) => p.text.trim());
  const status = body.status === "ACTIVE" ? "ACTIVE" : "DRAFT";
  if (status === "ACTIVE" && !prompts.length) return jsonError("At least one prompt is required");
  // A draft may start empty ("Untitled session" from New session), so the
  // editor can fill it; it cannot launch until it has a question.

  let departmentId: string | null = null;
  if (body.departmentId) {
    const dept = await prisma.department.findFirst({ where: { id: String(body.departmentId), organizationId: orgId }, select: { id: true } });
    if (!dept) return jsonError("Invalid department", 400);
    departmentId = dept.id;
  }

  const candor = await prisma.candorSession.create({
    data: {
      title,
      description: typeof body.description === "string" ? body.description.trim().slice(0, 5000) || null : null,
      prompts,
      departmentId,
      status,
      createdBy: userId,
      organizationId: orgId,
      launchedAt: status === "ACTIVE" ? new Date() : null,
    },
  });

  if (status === "ACTIVE") await notifyCandorOpen(candor, orgId, userId);

  return jsonSuccess(candor, 201);
}

export async function PATCH(req: NextRequest) {
  const body = ((await req.json().catch(() => null)) ?? {}) as Record<string, unknown>;
  if (typeof body.id !== "string" || !body.id) return jsonError("Session ID required");
  const forward = new NextRequest(req.url, { method: "PATCH", headers: req.headers, body: JSON.stringify(body) });
  return patchOne(forward, { params: Promise.resolve({ id: body.id }) });
}
