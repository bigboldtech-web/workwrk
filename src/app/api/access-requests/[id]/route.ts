// PATCH /api/access-requests/:id  { decision: "grant" | "decline", role? }
//
// Answer one Request access (access-model-spec 5.6 item 2). "grant" writes
// the role through grants.ts setNodeGrant (mode "raise": a request never
// lowers a role the person already holds), so the Manage access dialog's
// rules hold here unchanged: only a Full holder of the object shares it, a
// role is never above the sharer's own, Private notes stay private. The
// request is resolved, the requester gets an inbox row, and the activity row
// is access.request.granted or access.request.declined.
//
// A kind grants.ts does not own (a SOP, a goal, a tool, a contract) can only
// be declined here; a grant answers 409 not_grantable with the object's own
// page, where it is shared.

import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { z } from "zod";
import { issueKey } from "@/lib/zod-issue-key";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { nodeCtxFromSession } from "@/lib/access/node-access";
import { GrantError, mayManageNode, setNodeGrant } from "@/lib/access/grants";
import { requestExpired, requestNodeRef } from "@/lib/access/access-requests";
import { requestTargetFor } from "@/lib/access/access-request-target";
import { freshWorkspaceActor, sessionIsWorkspaceAdmin } from "@/lib/access/workspace-admin";
import { logActivity } from "@/lib/activity";

const NO_STORE = { "Cache-Control": "no-store" } as const;

const bodySchema = z
  .object({
    decision: z.enum(["grant", "decline"]),
    role: z.enum(["VIEW", "COMMENT", "EDIT"]).optional(),
  })
  .strict();

type Params = { params: Promise<{ id: string }> };

export async function PATCH(req: Request, { params }: Params) {
  const session = await getServerSession(authOptions);
  const u = session?.user as { id?: string; organizationId?: string; firstName?: string; lastName?: string } | undefined;
  if (!u?.id || !u.organizationId) return NextResponse.json({ error: "Unauthorized" }, { status: 401, headers: NO_STORE });
  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    const key = issueKey(parsed.error.issues[0]);
    return NextResponse.json({ error: "invalid_body", key }, { status: 400, headers: NO_STORE });
  }
  const { id } = await params;
  const request = await prisma.accessRequest.findFirst({ where: { id, organizationId: u.organizationId } });
  if (!request) return NextResponse.json({ error: "Not found" }, { status: 404, headers: NO_STORE });
  if (request.status !== "PENDING" || requestExpired(request.createdAt)) {
    return NextResponse.json({ error: "closed", status: request.status }, { status: 409, headers: NO_STORE });
  }
  if (request.requesterId === u.id) return NextResponse.json({ error: "Forbidden" }, { status: 403, headers: NO_STORE });

  const target = await requestTargetFor(request.objectType, request.objectId, u.organizationId);
  const node = requestNodeRef(request.objectType, request.objectId);
  const actorName = `${u.firstName ?? ""} ${u.lastName ?? ""}`.trim() || "Someone";

  if (parsed.data.decision === "decline") {
    // Only someone who could have granted it declines it: the owner, an
    // Owner or Admin (re-read from the database, so an Admin demoted a moment
    // ago is refused now), or for a node anyone who clears the grant's own
    // manage bar (mayManageNode, the check setNodeGrant makes).
    let mayDecline = target.ownerId === u.id;
    if (!mayDecline && sessionIsWorkspaceAdmin(session)) {
      const fresh = await freshWorkspaceActor(session);
      mayDecline = fresh.ok && fresh.admin;
    }
    if (!mayDecline && node) {
      const managerCtx = await nodeCtxFromSession();
      mayDecline = !!managerCtx && (await mayManageNode(managerCtx, node));
    }
    if (!mayDecline) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403, headers: NO_STORE });
    }
    // Claim the answer first: one conditional update, so when two people
    // answer at once exactly one wins and the other is told it is closed
    // (no decline row for access that was granted, no second inbox row).
    if (!(await claim(request.id, "DENIED", u.id))) return closedNow(request.id);
    await tell(request.requesterId, `${actorName} declined your request`, "Ask them directly if you still need it.", target.link);
    await logActivity({
      organizationId: u.organizationId,
      actorId: u.id,
      type: "access.request.declined",
      targetType: request.objectType,
      targetId: request.objectId,
      description: `${actorName} declined an access request`,
      metadata: { requestId: request.id, requesterId: request.requesterId, role: request.role },
    }).catch(() => {});
    return NextResponse.json({ ok: true, status: "DENIED" }, { headers: NO_STORE });
  }

  if (!node) {
    return NextResponse.json({ error: "not_grantable", link: target.link }, { status: 409, headers: NO_STORE });
  }
  const ctx = await nodeCtxFromSession();
  if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401, headers: NO_STORE });
  const role = parsed.data.role ?? (request.role as "VIEW" | "COMMENT" | "EDIT");
  // Claim the answer BEFORE the grant is written, so a decline racing this
  // grant loses (409) instead of both succeeding. If the grant is then
  // refused (not a Full holder, a Private note, ...), the claim is released
  // and the request is pending again for someone who can answer it.
  if (!(await claim(request.id, "APPROVED", u.id))) return closedNow(request.id);
  try {
    await setNodeGrant(ctx, node, { userId: request.requesterId, role, mode: "raise" }, "dialog");
  } catch (err) {
    await release(request.id, u.id);
    if (err instanceof GrantError) return NextResponse.json({ error: err.code, message: err.message }, { status: err.status, headers: NO_STORE });
    throw err;
  }
  // grants.ts already tells the requester ("Shared with you", access_granted).
  const word = role === "EDIT" ? "Can edit" : role === "COMMENT" ? "Can comment" : "Can view";
  await logActivity({
    organizationId: u.organizationId,
    actorId: u.id,
    type: "access.request.granted",
    targetType: request.objectType,
    targetId: request.objectId,
    description: `${actorName} granted ${word} on request`,
    metadata: { requestId: request.id, requesterId: request.requesterId, role },
  }).catch(() => {});
  return NextResponse.json({ ok: true, status: "APPROVED", role }, { headers: NO_STORE });
}

/** Move a PENDING request to its answer. False when someone else answered it first. */
async function claim(id: string, status: "APPROVED" | "DENIED", deciderId: string): Promise<boolean> {
  const r = await prisma.accessRequest.updateMany({ where: { id, status: "PENDING" }, data: { status, decidedById: deciderId, decidedAt: new Date() } });
  return r.count === 1;
}

/**
 * Undo this person's APPROVED claim after the grant was refused. If the
 * requester opened a fresh request meanwhile (the one-PENDING index then
 * refuses the revert), this row closes as CANCELLED and the fresh one stands.
 */
async function release(id: string, deciderId: string): Promise<void> {
  try {
    await prisma.accessRequest.updateMany({ where: { id, status: "APPROVED", decidedById: deciderId }, data: { status: "PENDING", decidedById: null, decidedAt: null } });
  } catch {
    await prisma.accessRequest.updateMany({ where: { id, status: "APPROVED", decidedById: deciderId }, data: { status: "CANCELLED" } }).catch(() => {});
  }
}

async function closedNow(id: string) {
  const row = await prisma.accessRequest.findUnique({ where: { id }, select: { status: true } });
  return NextResponse.json({ error: "closed", status: row?.status ?? "CANCELLED" }, { status: 409, headers: NO_STORE });
}

async function tell(userId: string, title: string, message: string, link: string | null) {
  await prisma.notification.create({ data: { userId, title, message, type: "access_declined", link } }).catch(() => {});
}
