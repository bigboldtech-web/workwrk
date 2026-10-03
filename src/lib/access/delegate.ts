// Step 1's pivot for the node helpers (Phase 8 stage E): with
// ACCESS_V2_RESOLVER on AND ACCESS_V2_TABLES on (flags.ts delegateOn("node"),
// the only state the parity job proves), a helper's role on a Space, Folder,
// List or Doc is can()'s role, which is node-access's role through the bridge
// plus the engine's own rules around it (rule 1 status, rule 2 module and Apps
// config, rule 3 Notepads, rule 12 caps for Agents and Guests, the rule 13
// archived cap). Any other flag state returns the live node-access role the
// helper already computed, untouched. Server-only.

import type { NodeKind, NodeRole } from "./node-rules";
import type { ObjectType } from "./types";
import { delegateOn } from "./flags";

const ENGINE_TYPE: Readonly<Record<NodeKind, ObjectType>> = {
  space: "space",
  folder: "folder",
  list: "list",
  doc: "doc",
  table: "table",
  canvas: "whiteboard",
  form: "form",
};

/** The engine's four roles back onto the panel ladder; the Space Owner rung survives when node-access gave it. */
export function nodeRoleOfEngineRole(role: string, live: NodeRole): NodeRole {
  switch (role) {
    case "FULL":
      return live === "OWNER" ? "OWNER" : "FULL";
    case "COMMENT":
      // The engine has no List rung between Can comment and Can edit: keep
      // node-access's Can edit assigned tasks when that is what it gave.
      return live === "ASSIGNED" ? "ASSIGNED" : "COMMENT";
    case "EDIT":
    case "VIEW":
      return role;
    default:
      return "none";
  }
}

export async function delegatedNodeRole(
  userId: string,
  organizationId: string,
  accessLevel: string | null | undefined,
  ref: { kind: NodeKind; id: string },
  live: NodeRole,
): Promise<NodeRole> {
  if (!delegateOn("node")) return live;
  const [{ can }, { hydrate }, { orgRoleOf, isAgentOf, adminScopesOf, isSeededPeopleTeam }] = await Promise.all([
    import("./index"),
    import("./viewer"),
    import("./org-role"),
  ]);
  const level = accessLevel ?? "EMPLOYEE";
  const orgRole = orgRoleOf({ accessLevel: level });
  const viewer = await hydrate({
    userId,
    organizationId,
    orgRole,
    isAgent: isAgentOf(level),
    adminScopes: adminScopesOf(orgRole, null),
    peopleTeam: isSeededPeopleTeam(level),
  });
  const d = await can(viewer, "view", { type: ENGINE_TYPE[ref.kind], id: ref.id });
  return nodeRoleOfEngineRole(d.role, live);
}
