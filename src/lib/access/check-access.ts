// Check access and the peek payload (access-model-spec 5.3, 6.1 "Check
// access", step 3's POST /api/access/check and GET /api/access/peek; Phase 8
// stage E).
//
// Both read the LIVE resolver for the seven node kinds (node-access), never
// the engine over the old tables, so the sentence an admin reads is the
// answer every route gives today. With ACCESS_V2_RESOLVER and
// ACCESS_V2_TABLES on the helpers answer through can(), whose node roles are
// node-access's through the bridge, so the two stay one answer.

import { prisma } from "../prisma";
import { MANAGE_BAR, isAccessNodeKind, panelRoleLabel, type AccessNodeKind, type PanelRole } from "./access-panel";
import { nodeCtxForUser, nodePathWorld, nodeRole, type NodeCtx } from "./node-access";
import { roleAtLeast, type NodeDecision, type NodeRef, type NodeRows, type NodeVia } from "./node-rules";
import { nodeName } from "./node-tree";

export const NODE_NOUN: Readonly<Record<AccessNodeKind, string>> = {
  space: "Space",
  folder: "Folder",
  list: "List",
  doc: "Doc",
  table: "Table",
  canvas: "Canvas",
  form: "Form",
};

/** One plain sentence for where a person's role comes from. Pure. */
export function viaSentence(role: string, via: NodeVia, nameOf: (r: NodeRef) => string, orgName: string): string {
  if (role === "none") {
    return "No access. Nothing shares this with them, and nothing above it does.";
  }
  const label = panelRoleLabel(role as PanelRole);
  switch (via.type) {
    case "org_admin":
      return `${label}. They are an Owner or Admin of ${orgName}.`;
    case "own":
      return `${label}. Shared with them directly.`;
    case "owner":
      return `${label}. They own it.`;
    case "lift":
      return `${label}. They manage the Space and are named on this Folder.`;
    case "pierce":
      return `${label}. They own the Space it is in.`;
    case "inherited":
      return `${label}. From ${NODE_NOUN[via.node.kind]} ${nameOf(via.node)}.`;
    case "everyone":
      return via.node ? `${label}. ${NODE_NOUN[via.node.kind]} ${nameOf(via.node)} is open to everyone in ${orgName}.` : `${label}. Open to everyone in ${orgName}.`;
    case "floor":
      return `${label}. Kept from before the Private rule changed (their reach on the day of the change).`;
    default:
      return `${label}.`;
  }
}

export interface CheckResult {
  userId: string;
  name: string;
  role: string;
  sentence: string;
}

export type CheckRefusal = "not_found" | "forbidden" | "not_in_org";

/**
 * What one person can do on one node, for someone who may manage who has
 * access to it (the node's manage bar: Full access, Can edit on a doc) or an
 * Owner or Admin. Anyone else gets "not_found" when they cannot even see the
 * node and "forbidden" when they can, so the answer never confirms an id.
 */
export async function checkNodeAccess(actor: NodeCtx, ref: NodeRef, targetUserId: string): Promise<CheckResult | CheckRefusal> {
  if (!isAccessNodeKind(ref.kind)) return "not_found";
  const mine = await nodeRole(actor, ref);
  if (!actor.orgAdmin && !roleAtLeast(mine.role, "VIEW")) return "not_found";
  if (!actor.orgAdmin && !roleAtLeast(mine.role, MANAGE_BAR[ref.kind as AccessNodeKind])) return "forbidden";
  const [person, org] = await Promise.all([
    prisma.user.findUnique({ where: { id: targetUserId }, select: { organizationId: true, firstName: true, lastName: true, email: true, deletedAt: true } }),
    prisma.organization.findUnique({ where: { id: actor.organizationId }, select: { name: true } }),
  ]);
  if (!person || person.organizationId !== actor.organizationId || person.deletedAt) return "not_in_org";
  const ctx = await nodeCtxForUser(targetUserId, actor.organizationId);
  const world = await nodePathWorld(ctx, ref);
  const d: NodeDecision = world.self;
  const name = `${person.firstName ?? ""} ${person.lastName ?? ""}`.trim() || person.email;
  const nameOf = (r: NodeRef) => nodeName(world.rows as NodeRows, r);
  return { userId: targetUserId, name, role: d.role, sentence: viaSentence(d.role, d.via, nameOf, org?.name ?? "the workspace") };
}

export interface PeekPayload {
  kind: AccessNodeKind;
  name: string;
  owner: { name: string } | null;
}

/**
 * The LockedPage payload (spec 5.3): only kind, name and the owner's name,
 * never counts, descriptions or children, and only for a node the viewer can
 * already see or is on the way to (a path container, R10). Everything else
 * is null, which the route answers as a 404 identical to a missing id.
 */
export async function peekNode(ctx: NodeCtx, ref: NodeRef): Promise<PeekPayload | null> {
  if (!isAccessNodeKind(ref.kind) || ctx.orgGuest) return null;
  const d = await nodeRole(ctx, ref);
  if (d.role === "none" && !d.path) return null;
  const rows = (await nodePathWorld(ctx, ref)).rows as NodeRows;
  const ownerId = ownerOf(rows, ref);
  const owner = ownerId ? await prisma.user.findFirst({ where: { id: ownerId, organizationId: ctx.organizationId, deletedAt: null }, select: { firstName: true, lastName: true } }) : null;
  return {
    kind: ref.kind as AccessNodeKind,
    name: nodeName(rows, ref),
    owner: owner ? { name: `${owner.firstName ?? ""} ${owner.lastName ?? ""}`.trim() || "The owner" } : null,
  };
}

function ownerOf(rows: NodeRows, ref: NodeRef): string | null {
  switch (ref.kind) {
    case "space":
      return rows.spaces.get(ref.id)?.ownerId ?? null;
    case "folder":
      return rows.folders.get(ref.id)?.ownerId ?? null;
    case "list":
      return rows.lists.get(ref.id)?.ownerId ?? null;
    case "doc":
      return rows.docs.get(ref.id)?.createdById ?? null;
    case "table":
      return rows.tables.get(ref.id)?.createdById ?? null;
    case "canvas":
      return rows.canvases.get(ref.id)?.ownerId ?? null;
    case "form":
      return rows.forms.get(ref.id)?.createdById ?? null;
    default:
      return null;
  }
}
