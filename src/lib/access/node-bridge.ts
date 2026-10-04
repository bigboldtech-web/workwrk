// The node bridge (Phase 8 stage E, access-model-spec 10 step 4 under
// ACCESS_V2_TABLES).
//
// node-access (node-access.ts, node-rules.ts R0 to R12) is THE live resolver
// for Space, Folder, List (and its tasks), Doc, Table, Canvas and Form: it
// already unions the AccessGrant rows, the member tables, the docSharing
// store, the Private rule and the legacy floor. The spec's step 4 says "the
// loader unions AccessGrant with the mapped member tables"; for the node
// kinds that union already exists in ONE place, so with ACCESS_V2_TABLES on
// the engine's loader takes the viewer's node role from node-access as the
// object's own grant, instead of re-deriving it from the old tables a second
// way (two ladders answering one question is how the node-access hardening
// would regress). decide() still runs every rule around it: rule 1 (status),
// rule 2 (module and Apps config), rule 3 (Notepads), the rule 9 assignee
// rule on tasks, rule 12 caps (Agents, Guests), rule 13 action denials and
// rule 14 discoverability.
//
// The parity job (scripts/access-parity-job.mjs, the node-access section)
// compares can() against node-access with the flag off and on; the flag-on
// run is what proves this bridge.
//
// Pure half here; the one async function imports node-access lazily so the
// flag-off path never loads it.

import type { NodeKind, NodeRole } from "./node-rules";
import type { ChainLink, GrantFact, ObjectRef, ObjectRole, ObjectType, Viewer } from "./types";

/** Engine object type to node-access kind. A task follows its List. */
export const NODE_KIND_BY_OBJECT_TYPE: Readonly<Partial<Record<ObjectType, NodeKind>>> = {
  space: "space",
  folder: "folder",
  list: "list",
  doc: "doc",
  table: "table",
  whiteboard: "canvas",
  form: "form",
};

export function isBridgedType(type: ObjectType): boolean {
  return type === "item" || NODE_KIND_BY_OBJECT_TYPE[type] !== undefined;
}

/** node-access's five-rung panel role onto the four object roles. The Space Owner rung is Full access. */
export function objectRoleOfNodeRole(role: NodeRole): ObjectRole | null {
  switch (role) {
    case "OWNER":
    case "FULL":
      return "FULL";
    case "EDIT":
      return "EDIT";
    // The engine's four roles: Can edit assigned tasks reads as Can comment.
    case "ASSIGNED":
    case "COMMENT":
      return "COMMENT";
    case "VIEW":
      return "VIEW";
    default:
      return null;
  }
}

/**
 * Which node to ask, and which engine object the answer is a grant on. A task
 * asks its List (the first chain link) and the grant sits on the List, so the
 * engine's rule 10 carries it to the task and rule 9 still adds the assignee
 * row. Null when the ref is not a node type or a task has no List.
 */
export function bridgeTarget(
  ref: { type: ObjectType; id: string },
  chain: readonly ChainLink[],
): { node: { kind: NodeKind; id: string }; grantOn: { type: ObjectType; id: string } } | null {
  if (ref.type === "item") {
    const list = chain.find((l) => l.type === "list");
    if (!list) return null;
    return { node: { kind: "list", id: list.id }, grantOn: { type: "list", id: list.id } };
  }
  const kind = NODE_KIND_BY_OBJECT_TYPE[ref.type];
  if (!kind) return null;
  return { node: { kind, id: ref.id }, grantOn: { type: ref.type, id: ref.id } };
}

/** The one grant the engine sees for a node object: the viewer's node-access role, or none. */
export function bridgedGrants(grantOn: { type: ObjectType; id: string }, userId: string, role: NodeRole): GrantFact[] {
  const mapped = objectRoleOfNodeRole(role);
  if (!mapped) return [];
  return [
    {
      objectType: grantOn.type,
      objectId: grantOn.id,
      subjectType: "USER",
      subjectId: userId,
      role: mapped,
      expiresAt: null,
      source: "AccessGrant",
    },
  ];
}

/**
 * The grants loadFacts uses for a node ref with ACCESS_V2_TABLES on, or null
 * to keep the grants it loaded from the old tables (not a node type, or the
 * object was not found). Cross-org and missing objects stay with the loader:
 * rule 1 answers them before any grant is read.
 */
export async function nodeBridgeGrants(
  viewer: Viewer,
  ref: Extract<ObjectRef, { id: string }>,
  loaded: { object: { organizationId: string | null }; chain: readonly ChainLink[] },
): Promise<GrantFact[] | null> {
  if (!isBridgedType(ref.type)) return null;
  if (!loaded.object.organizationId || loaded.object.organizationId !== viewer.organizationId) return null;
  if (ref.type === "item") {
    // A task's live answer is item-gate (node-access's List role, the
    // assignee and creator rules, the Lists it is linked into). The grant sits
    // on the task itself, so nothing about the List's own restriction can
    // hide it again.
    const [{ gateItem }, { accessLevelMirror }] = await Promise.all([import("../item-gate"), import("./org-role")]);
    const g = await gateItem(ref.id, { userId: viewer.userId, organizationId: viewer.organizationId, accessLevel: accessLevelMirror(viewer.orgRole, viewer.isAgent), userName: null }, "view");
    const role = "error" in g ? "none" : g.decision.role;
    return bridgedGrants({ type: "item", id: ref.id }, viewer.userId, role as NodeRole);
  }
  const target = bridgeTarget(ref, loaded.chain);
  if (!target) return null;
  const { nodeRole, nodeCtxFromViewer } = await import("./node-access");
  const decision = await nodeRole(nodeCtxFromViewer(viewer), target.node);
  return bridgedGrants(target.grantOn, viewer.userId, decision.role);
}
