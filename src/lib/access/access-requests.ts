// The Request access flow's store (access-model-spec 5.6, Phase 8 stage E):
// one AccessRequest row per person per object while it is PENDING (a partial
// unique index in prisma/sql/2026-09-30-phase8-settings-access.sql), next to
// the inbox rows POST /api/access-requests already writes.
//
// Granting goes through grants.ts setNodeGrant for the seven node kinds, so
// every rule the Manage access dialog enforces (Full access to share, never
// above your own role, the last Full holder, Private notes, roles never
// climb) holds for a request exactly as for the dialog. Kinds node-access
// does not own (a SOP, a goal, a tool, a contract) can be declined here and
// are shared from the object itself: the answer says so and links there.

import { prisma } from "../prisma";
import type { NodeRef } from "./node-rules";

export type RequestRole = "VIEW" | "COMMENT" | "EDIT";
export type RequestStatus = "PENDING" | "APPROVED" | "DENIED" | "CANCELLED";

/** The node a request's object is, or null when grants.ts does not own that kind. */
export function requestNodeRef(objectType: string, objectId: string): NodeRef | null {
  switch (objectType) {
    case "space":
      return { kind: "space", id: objectId };
    case "folder":
      return { kind: "folder", id: objectId };
    case "list":
    case "board":
      return { kind: "list", id: objectId };
    case "doc":
      return { kind: "doc", id: objectId };
    case "table":
      return { kind: "table", id: objectId };
    case "canvas":
    case "whiteboard":
      return { kind: "canvas", id: objectId };
    case "form":
      return { kind: "form", id: objectId };
    default:
      return null;
  }
}

/** A request older than this reads as expired (spec 5.6 item 4: 14 days). */
export const REQUEST_TTL_MS = 14 * 24 * 60 * 60 * 1000;

export function requestExpired(createdAt: Date | string, now = Date.now()): boolean {
  return now - new Date(createdAt).getTime() > REQUEST_TTL_MS;
}

/** Record one PENDING request; a second one for the same person and object is the same request. */
export async function recordAccessRequest(input: {
  organizationId: string;
  requesterId: string;
  objectType: string;
  objectId: string;
  role: RequestRole;
  message?: string | null;
}): Promise<{ id: string; created: boolean }> {
  const existing = await prisma.accessRequest.findFirst({
    where: { requesterId: input.requesterId, objectType: input.objectType, objectId: input.objectId, status: "PENDING" },
    select: { id: true, createdAt: true },
  });
  if (existing && !requestExpired(existing.createdAt)) return { id: existing.id, created: false };
  if (existing) {
    // An expired request closes before a fresh one opens (the index allows one PENDING).
    await prisma.accessRequest.update({ where: { id: existing.id }, data: { status: "CANCELLED", decidedAt: new Date() } });
  }
  try {
    const row = await prisma.accessRequest.create({
      data: {
        organizationId: input.organizationId,
        requesterId: input.requesterId,
        objectType: input.objectType,
        objectId: input.objectId,
        role: input.role,
        message: input.message ?? null,
      },
      select: { id: true },
    });
    return { id: row.id, created: true };
  } catch (err) {
    // A second tab won the race to the partial unique index: that row is the request.
    const again = await prisma.accessRequest.findFirst({
      where: { requesterId: input.requesterId, objectType: input.objectType, objectId: input.objectId, status: "PENDING" },
      select: { id: true },
    });
    if (again) return { id: again.id, created: false };
    throw err;
  }
}
