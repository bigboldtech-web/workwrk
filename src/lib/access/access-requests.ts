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

/**
 * The objectType spellings a request on this node may be stored under: a
 * List is asked for as "list" or "board" and a Canvas as "canvas" or
 * "whiteboard" (requestNodeRef reads both), so resolving a grant matches both.
 */
export function requestTypesForNode(kind: NodeRef["kind"]): string[] {
  if (kind === "list") return ["list", "board"];
  if (kind === "canvas") return ["canvas", "whiteboard"];
  return [kind];
}

// VIEW < COMMENT < EDIT < FULL < OWNER, the same ladder as PANEL_ROLE_RANK,
// kept here so this module stays importable without the panel vocabulary.
const HELD_RANK: Readonly<Record<string, number>> = { VIEW: 1, COMMENT: 2, EDIT: 3, FULL: 4, OWNER: 5 };
const REQUEST_ROLES: readonly RequestRole[] = ["VIEW", "COMMENT", "EDIT"];

/** Does a role the person holds now answer a request for `asked`? None never does; an unknown ask reads as Edit. */
export function roleCoversRequest(held: string | null | undefined, asked: string): boolean {
  const have = held ? HELD_RANK[held] ?? 0 : 0;
  const want = HELD_RANK[asked] ?? HELD_RANK.EDIT;
  return have > 0 && have >= want;
}

/** The request roles a held role answers (Edit answers Edit, Comment and View). */
export function requestRolesCoveredBy(held: string | null | undefined): RequestRole[] {
  return REQUEST_ROLES.filter((r) => roleCoversRequest(held, r));
}

/**
 * Close this person's open requests on one object as APPROVED, because what
 * they asked for was given some other way: shared from the Manage access
 * dialog, a members route, or the object's own page (spec 5.6 item 2, "a
 * grant through grants.ts resolves the request"). Before this only the
 * Access requests card ever closed a request, so a request answered by
 * sharing from the object sat open for 14 days, and the only way to clear it
 * was Decline, which told the requester "declined" while they held the access.
 *
 * `roles` limits it to the asks the grant covers (a View grant leaves an
 * Edit request open); null closes every open ask on the object. No
 * notification: the grant already told the requester. Best effort, never
 * throws: a grant is never undone because its request could not be closed.
 */
export async function resolveRequestsFor(input: {
  organizationId: string;
  objectTypes: string[];
  objectId: string;
  requesterId: string;
  roles: RequestRole[] | null;
  deciderId: string | null;
}): Promise<number> {
  if (input.objectTypes.length === 0 || (input.roles && input.roles.length === 0)) return 0;
  try {
    const r = await prisma.accessRequest.updateMany({
      where: {
        organizationId: input.organizationId,
        requesterId: input.requesterId,
        objectId: input.objectId,
        objectType: { in: input.objectTypes },
        status: "PENDING",
        createdAt: { gte: new Date(Date.now() - REQUEST_TTL_MS) },
        ...(input.roles ? { role: { in: input.roles } } : {}),
      },
      data: { status: "APPROVED", decidedById: input.deciderId, decidedAt: new Date() },
    });
    return r.count;
  } catch (err) {
    console.error("[access-requests] resolve failed:", err instanceof Error ? err.message : err);
    return 0;
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
