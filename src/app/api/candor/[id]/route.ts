// /api/candor/[id]: one candor session (spec-teams-performance /candor/[id]).
//
// GET     the session and what the viewer may do with it (faces). A session
//         the viewer may not see is a 404, and so is one that does not
//         exist: the two are deliberately the same to the viewer. The
//         answer count goes to the people who run it, never to respondents
//         (a respondent must never infer who answered).
// PATCH   { title?, description?, departmentId?, prompts?, status? }: the
//         owner, the People team and Admin. Prompts and scope change only
//         while it is a Draft (answers are keyed to them). Status moves:
//         Draft to Open (launch, which notifies the scope), Open to Closed,
//         Closed to Open (reopen, the close date cleared). The scope must
//         be one the organiser may ask (candorScopesFor), checked when it
//         changes and again on every move to Open, so a Draft saved before
//         the rule, or by someone whose reports have since moved, cannot
//         launch beyond their chain. GET sends `scopes` to the editor so the
//         picker offers only those.
// DELETE  a Draft only (nothing has been answered), never by an Agent.

import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSessionOrFail, jsonError, jsonSuccess } from "@/lib/api-helpers";
import { candorCtx, candorFaces, candorScopeRefusal, candorScopesFor, hasAnsweredCandor, notifyCandorOpen } from "@/lib/performance/candor.server";
import { candorTransitionBlocked, normalizeCandorPrompts } from "@/lib/performance/candor";
import { logActivity } from "@/lib/activity";

async function load(id: string, organizationId: string) {
  return prisma.candorSession.findFirst({ where: { id, organizationId } });
}

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { error } = await getSessionOrFail();
  if (error) return error;
  const ctx = await candorCtx();
  if (!ctx) return jsonError("Not found", 404);
  const { id } = await params;
  const s = await load(id, ctx.organizationId);
  if (!s) return jsonError("Not found", 404);
  const faces = candorFaces(ctx, s, await hasAnsweredCandor(id, ctx.userId));
  if (!faces.visible) return jsonError("Not found", 404);
  const [responseCount, dept, scopes] = await Promise.all([
    faces.canManage ? prisma.candorResponse.count({ where: { sessionId: id } }) : Promise.resolve(null),
    s.departmentId ? prisma.department.findFirst({ where: { id: s.departmentId, organizationId: ctx.organizationId }, select: { id: true, name: true } }) : Promise.resolve(null),
    // Only the editor needs it (a Draft someone may manage).
    faces.canManage && s.status === "DRAFT" ? candorScopesFor(ctx) : Promise.resolve(null),
  ]);
  return jsonSuccess({
    id: s.id,
    title: s.title,
    description: s.description,
    status: s.status,
    departmentId: s.departmentId,
    department: dept,
    prompts: normalizeCandorPrompts(s.prompts),
    launchedAt: s.launchedAt,
    closedAt: s.closedAt,
    createdAt: s.createdAt,
    ...(faces.canManage ? { responseCount } : {}),
    ...(scopes ? { scopes } : {}),
    faces: { ...faces, canDelete: faces.canManage && !ctx.isAgent && s.status === "DRAFT", canExport: faces.canManage && !ctx.isAgent },
  }, 200);
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { error } = await getSessionOrFail();
  if (error) return error;
  const ctx = await candorCtx();
  if (!ctx) return jsonError("Not found", 404);
  const { id } = await params;
  const s = await load(id, ctx.organizationId);
  if (!s) return jsonError("Not found", 404);
  const faces = candorFaces(ctx, s, false);
  if (!faces.canManage) return jsonError(faces.visible ? "Only the person who runs this session can change it" : "Not found", faces.visible ? 403 : 404);

  const body = ((await req.json().catch(() => null)) ?? {}) as Record<string, unknown>;
  const data: Record<string, unknown> = {};
  if (typeof body.title === "string") {
    const t = body.title.trim().slice(0, 200);
    if (!t) return jsonError("A session needs a title", 400);
    data.title = t;
  }
  if (body.description !== undefined) data.description = typeof body.description === "string" ? body.description.trim().slice(0, 5000) || null : null;
  const editingShape = body.prompts !== undefined || body.departmentId !== undefined;
  if (editingShape && s.status !== "DRAFT") return jsonError("The questions and who can answer are fixed once the session opens", 409);
  if (body.prompts !== undefined) {
    const prompts = normalizeCandorPrompts(body.prompts).filter((p) => p.text.trim());
    if (!prompts.length) return jsonError("A session needs at least one question", 400);
    data.prompts = prompts;
  }
  if (body.departmentId !== undefined) {
    if (body.departmentId) {
      const d = await prisma.department.findFirst({ where: { id: String(body.departmentId), organizationId: ctx.organizationId }, select: { id: true } });
      if (!d) return jsonError("Invalid department", 400);
      data.departmentId = d.id;
    } else data.departmentId = null;
  }
  let launched = false;
  if (typeof body.status === "string" && body.status !== s.status) {
    const blocked = candorTransitionBlocked(s.status, body.status);
    if (blocked) return jsonError(blocked, 409);
    if (body.status === "ACTIVE") {
      const prompts = normalizeCandorPrompts(data.prompts ?? s.prompts).filter((p) => p.text.trim());
      if (!prompts.length) return jsonError("Add at least one question before you launch", 400);
      data.prompts = prompts;
      data.status = "ACTIVE";
      data.closedAt = null;
      if (s.status === "DRAFT") { data.launchedAt = new Date(); launched = true; }
    } else if (body.status === "CLOSED") {
      data.status = "CLOSED";
      data.closedAt = new Date();
    }
  }
  // The scope rule (lib/performance/candor.server.ts candorScopesFor): on a
  // change of who it asks, and on every move to Open with the scope it will
  // open with. An autosave that resends the unchanged scope of an older
  // Draft still saves its title and questions; only the launch is refused.
  const nextDept = data.departmentId !== undefined ? (data.departmentId as string | null) : s.departmentId;
  if (nextDept !== s.departmentId || data.status === "ACTIVE") {
    const refused = candorScopeRefusal(await candorScopesFor(ctx), nextDept);
    if (refused) return jsonError(refused, 403);
  }
  const updated = await prisma.candorSession.update({ where: { id }, data });
  if (launched) await notifyCandorOpen(updated, ctx.organizationId, ctx.userId);
  if (data.status) {
    logActivity({
      type: "candor_session.status",
      actorId: ctx.userId,
      organizationId: ctx.organizationId,
      description: `${data.status === "ACTIVE" ? (launched ? "Launched" : "Reopened") : "Closed"} candor session: ${updated.title}`,
      targetId: id,
      targetType: "candor_session",
      metadata: { from: s.status, to: data.status },
    });
  }
  return jsonSuccess({ ...updated, prompts: normalizeCandorPrompts(updated.prompts) });
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { error } = await getSessionOrFail();
  if (error) return error;
  const ctx = await candorCtx();
  if (!ctx) return jsonError("Not found", 404);
  const { id } = await params;
  const s = await load(id, ctx.organizationId);
  if (!s) return jsonError("Not found", 404);
  const faces = candorFaces(ctx, s, false);
  if (!faces.canManage || ctx.isAgent) return jsonError(faces.visible ? "Forbidden" : "Not found", faces.visible ? 403 : 404);
  if (s.status !== "DRAFT") return jsonError("Only a draft can be deleted. Close the session instead.", 409);
  const answered = await prisma.candorResponse.count({ where: { sessionId: id } });
  if (answered > 0) return jsonError("Someone has answered this session, so it cannot be deleted", 409);
  await prisma.candorSession.delete({ where: { id } });
  logActivity({ type: "candor_session.delete", actorId: ctx.userId, organizationId: ctx.organizationId, description: `Deleted candor draft: ${s.title}`, targetId: id, targetType: "candor_session" });
  return jsonSuccess({ id });
}
