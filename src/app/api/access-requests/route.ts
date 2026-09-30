// POST /api/access-requests (access-model-spec 5.6, spec-shell 1.6): the
// Request access primary on a LockedPage. Until the AccessRequest table
// lands (an additive schema item owned by the access unit) a request is an
// inbox row for the object's owner, or for every Owner and Admin when the
// object has no owner, so a real person sees it and can share the object.
// One request per person per object per 24h re-notifies at most once.

import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { z } from "zod";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { listOrgAdmins } from "@/lib/access/admins";
import { canSeeGoal } from "@/lib/goal-audience";
import { recordAccessRequest, requestNodeRef, REQUEST_TTL_MS } from "@/lib/access/access-requests";
import { OWNER_FIELD, requestObjectName, requestTargetFor as targetFor } from "@/lib/access/access-request-target";
import { sessionIsWorkspaceAdmin } from "@/lib/access/workspace-admin";

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
  // Only for an object that exists in this org (a link was found) or a node
  // kind grants.ts owns; an id probe never leaves a row behind.
  let requestId: string | null = null;
  const knownKind = objectType in OWNER_FIELD || requestNodeRef(objectType, objectId) !== null;
  const exists = link ? true : requestNodeRef(objectType, objectId) ? await nodeExists(objectType, objectId, u.organizationId) : false;
  if (exists) {
    requestId = (await recordAccessRequest({ organizationId: u.organizationId, requesterId: u.id, objectType, objectId, role, message: message ?? null })).id;
  } else if (knownKind) {
    // A known kind whose object is not in this workspace: the same answer a
    // real request gets, and nobody's inbox fills up from an id probe.
    return NextResponse.json({ ok: true, notified: 0, requestId: null }, { status: 201 });
  }
  const targets = ownerId && ownerId !== u.id
    ? [ownerId]
    : (await listOrgAdmins(u.organizationId, 10)).map((a) => a.id).filter((id) => id !== u.id);
  if (targets.length === 0) return NextResponse.json({ ok: true, notified: 0, requestId });

  const requester = `${u.firstName ?? ""} ${u.lastName ?? ""}`.trim() || u.name || "Someone";
  const title = `${requester} asked for access`;
  const roleWord = role === "EDIT" ? "edit" : role === "COMMENT" ? "comment on" : "view";
  const text = `${requester} wants to ${roleWord} a ${objectType}.${message ? ` "${message}"` : ""}`;

  // Re-notify at most once per 24h per requester per object.
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const recent = await prisma.notification.findFirst({
    where: { userId: { in: targets }, type: "access_request", link, title, createdAt: { gte: since } },
    select: { id: true },
  });
  if (recent) return NextResponse.json({ ok: true, notified: 0, throttled: true, requestId });

  await prisma.notification.createMany({
    data: targets.map((userId) => ({ userId, title, message: text, type: "access_request", link })),
  });
  return NextResponse.json({ ok: true, notified: targets.length, requestId }, { status: 201 });
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
 * days) are left out.
 */
export async function GET() {
  const session = await getServerSession(authOptions);
  const u = session?.user as { id?: string; organizationId?: string; accessLevel?: string } | undefined;
  if (!u?.id || !u.organizationId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const admin = sessionIsWorkspaceAdmin(session);
  const since = new Date(Date.now() - REQUEST_TTL_MS);
  const [pending, mine] = await Promise.all([
    prisma.accessRequest.findMany({
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
  const incoming = [];
  for (const r of pending) {
    if (r.requesterId === u.id) continue;
    const t = await targetFor(r.objectType, r.objectId, u.organizationId);
    if (!admin && t.ownerId !== u.id) continue;
    incoming.push({
      id: r.id,
      objectType: r.objectType,
      objectId: r.objectId,
      role: r.role,
      message: r.message,
      createdAt: r.createdAt,
      link: t.link,
      name: await requestObjectName(r.objectType, r.objectId, u.organizationId),
      grantable: requestNodeRef(r.objectType, r.objectId) !== null,
      requester: { id: r.requester.id, name: `${r.requester.firstName ?? ""} ${r.requester.lastName ?? ""}`.trim() || r.requester.email, avatar: r.requester.avatar },
    });
  }
  return NextResponse.json({ incoming, outgoing: mine }, { headers: { "Cache-Control": "no-store" } });
}
