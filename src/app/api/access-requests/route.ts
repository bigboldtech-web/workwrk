// POST /api/access-requests (access-model-spec 5.6, spec-shell 1.6): the
// Request access primary on a LockedPage. Until the AccessRequest table
// lands (an additive schema item owned by the access unit) a request is an
// inbox row for the object's owner, or for every Owner and Admin when the
// object has no owner, so a real person sees it and can share the object.
// One request per person per object per 24h notifies at most once.

import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { z } from "zod";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { listOrgAdmins } from "@/lib/access/admins";
import { canSeeGoal } from "@/lib/goal-audience";
import { recordAccessRequest, requestNodeRef, roleCoversRequest, REQUEST_TTL_MS } from "@/lib/access/access-requests";
import { nodeCtxForUser, nodeCtxFromSession, nodeRole } from "@/lib/access/node-access";
import { OWNER_FIELD, requestObjectName, requestTargetFor as targetFor } from "@/lib/access/access-request-target";
import { freshWorkspaceActor, sessionIsWorkspaceAdmin } from "@/lib/access/workspace-admin";
import { logActivity } from "@/lib/activity";

const bodySchema = z.object({
  objectType: z.string().min(1).max(40),
  objectId: z.string().min(1).max(80),
  role: z.enum(["VIEW", "EDIT", "COMMENT"]).default("VIEW"),
  message: z.string().max(500).optional(),
});

export async function POST(req: Request) {
  const session = await getServerSession(authOptions);
  const u = session?.user as { id?: string; organizationId?: string; firstName?: string; lastName?: string; name?: string } | undefined;
  if (!u?.id || !u.organizationId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  const { objectType, objectId, role, message } = parsed.data;

  // A goal is never discoverable (spec-goals section 1): only a viewer who
  // can already see it may ask its owner, so a request never confirms that
  // a goal id exists.
  if (objectType === "goal") {
    const g = await prisma.oKR.findFirst({ where: { id: objectId, organizationId: u.organizationId }, select: { id: true, level: true, ownerId: true, departmentId: true } });
    if (!g || !(await canSeeGoal(session, g))) return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  const { ownerId, link } = await targetFor(objectType, objectId, u.organizationId);
  // Phase 8 stage E: the request itself, one PENDING row per person per
  // object, which the deciders list and answer (GET below, PATCH [id]).
  //
  // THE ANSWER IS THE SAME WHETHER THE OBJECT EXISTS OR NOT: 201
  // { ok, throttled }, so an id probe learns nothing (no request id, no
  // count of people told). Throttled means this person asked for this very
  // object in the last 24 hours: read from the request rows for a real
  // object, and from a per-process memory for an id that is not there, so a
  // repeated probe answers exactly as a repeated real request does.
  const knownKind = objectType in OWNER_FIELD || requestNodeRef(objectType, objectId) !== null;
  const exists = link ? true : requestNodeRef(objectType, objectId) ? await nodeExists(objectType, objectId, u.organizationId) : false;
  const since = new Date(Date.now() - THROTTLE_MS);
  if (!exists && knownKind) {
    return uniform(probeThrottled(`${u.id}:${objectType}:${objectId}`));
  }
  let throttled = false;
  if (exists) {
    // The 24h throttle is per person per OBJECT (never per link or kind, so a
    // request on a second doc is never swallowed by one on the first).
    throttled = !!(await prisma.accessRequest.findFirst({
      where: { requesterId: u.id, objectType, objectId, createdAt: { gte: since } },
      select: { id: true },
    }));
    await recordAccessRequest({ organizationId: u.organizationId, requesterId: u.id, objectType, objectId, role, message: message ?? null });
  }
  if (throttled) return uniform(true);
  const targets = ownerId && ownerId !== u.id
    ? [ownerId]
    : (await listOrgAdmins(u.organizationId, 10)).map((a) => a.id).filter((id) => id !== u.id);
  if (targets.length === 0) return uniform(false);

  const requester = `${u.firstName ?? ""} ${u.lastName ?? ""}`.trim() || u.name || "Someone";
  const title = `${requester} asked for access`;
  const roleWord = role === "EDIT" ? "edit" : role === "COMMENT" ? "comment on" : "view";
  const text = `${requester} wants to ${roleWord} a ${objectType}.${message ? ` "${message}"` : ""}`;

  // A kind with no request row (not a known kind): the older throttle, per
  // title and link, at most once per 24h.
  if (!exists) {
    const recent = await prisma.notification.findFirst({
      where: { userId: { in: targets }, type: "access_request", link, title, createdAt: { gte: since } },
      select: { id: true },
    });
    if (recent) return uniform(true);
  }

  await prisma.notification.createMany({
    data: targets.map((userId) => ({ userId, title, message: text, type: "access_request", link })),
  });
  return uniform(false);
}

const THROTTLE_MS = 24 * 60 * 60 * 1000;

function uniform(throttled: boolean) {
  return NextResponse.json({ ok: true, throttled }, { status: 201, headers: { "Cache-Control": "no-store" } });
}

// Ids asked for that are not in the workspace, per requester, so a second ask
// answers `throttled` exactly as a real object's second request does.
const probes = new Map<string, number>();
function probeThrottled(key: string, now = Date.now()): boolean {
  const last = probes.get(key);
  if (last !== undefined && now - last < THROTTLE_MS) return true;
  if (probes.size >= 20000) probes.clear();
  probes.set(key, now);
  return false;
}

/** Does this node exist in the org? (docs, tables, canvases and forms have no targetFor link.) */
async function nodeExists(objectType: string, id: string, organizationId: string): Promise<boolean> {
  const where = { id, organizationId };
  switch (requestNodeRef(objectType, id)?.kind) {
    case "doc":
      return !!(await prisma.doc.findFirst({ where, select: { id: true } }));
    case "table":
      return !!(await prisma.dataTable.findFirst({ where, select: { id: true } }));
    case "canvas":
      return !!(await prisma.whiteboard.findFirst({ where, select: { id: true } }));
    case "form":
      return !!(await prisma.formDefinition.findFirst({ where, select: { id: true } }));
    default:
      return false;
  }
}

/**
 * GET /api/access-requests: the open requests this person may answer
 * (incoming: every request in the workspace for an Owner or Admin, else the
 * requests on objects they own) and their own (outgoing). Expired rows (14
 * days) are left out. ?scope=outgoing answers the person's own requests
 * alone (the Request access button reads it to show "Request pending").
 *
 * A request on a Doc, Table, Canvas or Form the decider cannot read (another
 * person's Private note, which node-access keeps 404 even for Admins) is not
 * listed to them at all: they could not grant it, and its name would leak.
 */
export async function GET(req: Request) {
  const session = await getServerSession(authOptions);
  const u = session?.user as { id?: string; organizationId?: string; accessLevel?: string } | undefined;
  if (!u?.id || !u.organizationId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  // Every request in the workspace (with the requester's own message) is for
  // an Owner or Admin as the DATABASE has them now: the session's claim is
  // re-checked only every five minutes, so an Admin demoted a moment ago
  // falls back at once to the requests on objects they own.
  const admin = sessionIsWorkspaceAdmin(session) ? await freshWorkspaceActor(session).then((f) => f.ok && f.admin) : false;
  const since = new Date(Date.now() - REQUEST_TTL_MS);
  const outgoingOnly = new URL(req.url).searchParams.get("scope") === "outgoing";
  const [pending, mine] = await Promise.all([
    outgoingOnly
      ? Promise.resolve([])
      : prisma.accessRequest.findMany({
          where: { organizationId: u.organizationId, status: "PENDING", createdAt: { gte: since } },
          orderBy: { createdAt: "desc" },
          take: 100,
          include: { requester: { select: { id: true, firstName: true, lastName: true, email: true, avatar: true } } },
        }),
    prisma.accessRequest.findMany({
      where: { requesterId: u.id, createdAt: { gte: since } },
      orderBy: { createdAt: "desc" },
      take: 20,
      select: { id: true, objectType: true, objectId: true, role: true, status: true, createdAt: true, decidedAt: true },
    }),
  ]);
  const ctx = pending.length > 0 ? await nodeCtxFromSession() : null;
  const requesterCtx = new Map<string, Awaited<ReturnType<typeof nodeCtxForUser>>>();
  const incoming = [];
  for (const r of pending) {
    if (r.requesterId === u.id) continue;
    const t = await targetFor(r.objectType, r.objectId, u.organizationId);
    if (!admin && t.ownerId !== u.id) continue;
    const node = requestNodeRef(r.objectType, r.objectId);
    if (node && (node.kind === "doc" || node.kind === "table" || node.kind === "canvas" || node.kind === "form")) {
      if (!ctx) continue;
      const d = await nodeRole(ctx, node);
      if (d.role === "none") continue;
    }
    // Already answered some other way: the requester now owns the object, or
    // holds at least what they asked for on the node (shared from its menu
    // before grants closed requests, or through a Team or Everyone). The row
    // closes here instead of waiting 14 days for a Decline that would tell
    // them "declined" while they hold the access.
    let answered = t.ownerId === r.requesterId;
    if (!answered && node) {
      let rc = requesterCtx.get(r.requesterId);
      if (!rc) {
        rc = await nodeCtxForUser(r.requesterId, u.organizationId);
        requesterCtx.set(r.requesterId, rc);
      }
      answered = roleCoversRequest((await nodeRole(rc, node)).role, r.role);
    }
    if (answered) {
      await prisma.accessRequest.updateMany({ where: { id: r.id, status: "PENDING" }, data: { status: "APPROVED", decidedAt: new Date() } }).catch(() => {});
      continue;
    }
    incoming.push({
      id: r.id,
      objectType: r.objectType,
      objectId: r.objectId,
      role: r.role,
      message: r.message,
      createdAt: r.createdAt,
      link: t.link,
      name: await requestObjectName(r.objectType, r.objectId, u.organizationId),
      grantable: node !== null,
      requester: { id: r.requester.id, name: `${r.requester.firstName ?? ""} ${r.requester.lastName ?? ""}`.trim() || r.requester.email, avatar: r.requester.avatar },
    });
  }
  return NextResponse.json({ incoming, outgoing: mine }, { headers: { "Cache-Control": "no-store" } });
}

/**
 * PATCH /api/access-requests  { id, decision: "shared" }
 *
 * Close a request on a kind the card cannot grant (a SOP, a goal, a tool, an
 * agreement) after its owner shared it from the object's own page: APPROVED,
 * with no inbox row, so the requester is never told "declined" for access
 * they were given. A node (Space, Folder, List, Doc, Table, Canvas, Form) is
 * answered with a real grant (PATCH /api/access-requests/[id]), which also
 * closes it, so it is refused here: this is never a way to mark access given
 * that was not. The same people who may decline it may close it: its owner,
 * or an Owner or Admin as the database has them now.
 */
const closeSchema = z.object({ id: z.string().min(1).max(80), decision: z.literal("shared") }).strict();

export async function PATCH(req: Request) {
  const session = await getServerSession(authOptions);
  const u = session?.user as { id?: string; organizationId?: string; firstName?: string; lastName?: string } | undefined;
  if (!u?.id || !u.organizationId) return NextResponse.json({ error: "Unauthorized" }, { status: 401, headers: NO_STORE });
  const parsed = closeSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "invalid_body" }, { status: 400, headers: NO_STORE });
  const request = await prisma.accessRequest.findFirst({ where: { id: parsed.data.id, organizationId: u.organizationId } });
  if (!request) return NextResponse.json({ error: "Not found" }, { status: 404, headers: NO_STORE });
  if (request.status !== "PENDING" || Date.now() - request.createdAt.getTime() > REQUEST_TTL_MS) {
    return NextResponse.json({ error: "closed", status: request.status }, { status: 409, headers: NO_STORE });
  }
  if (request.requesterId === u.id) return NextResponse.json({ error: "Forbidden" }, { status: 403, headers: NO_STORE });
  if (requestNodeRef(request.objectType, request.objectId)) {
    return NextResponse.json({ error: "use_grant" }, { status: 409, headers: NO_STORE });
  }
  const t = await targetFor(request.objectType, request.objectId, u.organizationId);
  let may = t.ownerId === u.id;
  if (!may && sessionIsWorkspaceAdmin(session)) {
    const fresh = await freshWorkspaceActor(session);
    may = fresh.ok && fresh.admin;
  }
  if (!may) return NextResponse.json({ error: "Forbidden" }, { status: 403, headers: NO_STORE });
  // One conditional update: when two people answer at once exactly one wins.
  const won = await prisma.accessRequest.updateMany({ where: { id: request.id, status: "PENDING" }, data: { status: "APPROVED", decidedById: u.id, decidedAt: new Date() } });
  if (won.count !== 1) {
    const row = await prisma.accessRequest.findUnique({ where: { id: request.id }, select: { status: true } });
    return NextResponse.json({ error: "closed", status: row?.status ?? "CANCELLED" }, { status: 409, headers: NO_STORE });
  }
  const actorName = `${u.firstName ?? ""} ${u.lastName ?? ""}`.trim() || "Someone";
  await logActivity({
    organizationId: u.organizationId,
    actorId: u.id,
    type: CLOSED_TYPE,
    targetType: request.objectType,
    targetId: request.objectId,
    description: `${actorName} marked an access request as shared`,
    metadata: { requestId: request.id, requesterId: request.requesterId, role: request.role },
  }).catch(() => {});
  return NextResponse.json({ ok: true, status: "APPROVED" }, { headers: NO_STORE });
}

const NO_STORE = { "Cache-Control": "no-store" } as const;
// The activity type, beside access.request.granted and .declined.
const CLOSED_TYPE = "access.request.shared";
