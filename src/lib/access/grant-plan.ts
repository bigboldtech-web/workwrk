// Validating and planning ONE change to who can open a node, before any row
// is written.
//
// grants.ts is the only writer of person grants. Inside its transaction it
// reads the person's current direct row and asks planGrant (or planRemove)
// what to do: which store to write, which stored role, whether to notify,
// whether the change is a no-op, or which named refusal to answer. Keeping
// the decision here, pure, is what lets grant-plan.test.ts pin every refusal
// the Manage access dialog can show.
//
// Stored roles, per kind (decision A9, reuse the existing ladder):
//   space   SpaceMember: Owner writes OWNER, Full access writes ADMIN, Can
//           edit MEMBER, Can view GUEST.
//   folder  FolderMember and list BoardMember: Full access writes ADMIN (an
//           existing OWNER row is kept), Can edit MEMBER, Can view GUEST.
//   doc     Organization.settings.docSharing[docId].roles[userId] (with the
//           members projection beside it, written by the store).
//   table, canvas, form: an AccessGrant row, ADMIN, MEMBER or GUEST.
//
// Pure: imports ./access-panel and ./node-rules only.

import {
  MANAGE_BAR,
  PANEL_ROLE_RANK,
  ROLES_BY_KIND,
  type AccessNodeKind,
  type GrantErrorCode,
  type PanelRole,
} from "./access-panel";
import { roleAtLeast, type MemberRole, type NodeRole } from "./node-rules";

export type GrantStore = "SpaceMember" | "FolderMember" | "BoardMember" | "DocSharing" | "AccessGrant";

export const STORE_BY_KIND: Readonly<Record<AccessNodeKind, GrantStore>> = {
  space: "SpaceMember",
  folder: "FolderMember",
  list: "BoardMember",
  doc: "DocSharing",
  table: "AccessGrant",
  canvas: "AccessGrant",
  form: "AccessGrant",
};

/** What a store holds: a SpaceRole value for the member tables and AccessGrant, a role name for doc roles. */
export type StoredRole = MemberRole | PanelRole;

export type NotifyKind = "none" | "shared" | "upgraded";

export interface GrantPlanInput {
  kind: AccessNodeKind;
  /** The person's current DIRECT role on the node, or null when they hold no row. */
  current: PanelRole | null;
  /** The stored value behind `current` (OWNER vs ADMIN both read Full access on a Folder). */
  currentRow?: StoredRole | null;
  requested: PanelRole;
  /** What the client last showed for this person; undefined means "do not check". */
  expected?: PanelRole | null;
  /** "raise" (bulk adds) never lowers an existing role. */
  mode?: "set" | "raise";
  /** The highest role the actor may give here, or null when they cannot manage it. */
  actorMax: PanelRole | null;
  /** The grantee made this doc, table, canvas or form: their Full access is fixed. */
  isObjectOwner?: boolean;
  /** The node is, or sits under, a private note. */
  notepad?: boolean;
  /** Space only: active OWNER or ADMIN rows on the Space other than the target's. */
  spaceFullOthers?: number;
  /** The grantee can still sign in (deletedAt null and not INACTIVE). */
  targetActive?: boolean;
  /** The grantee is a member of the node's org (add and change only). */
  targetInOrg?: boolean;
  /** The actor is changing their own access. */
  self?: boolean;
}

export interface GrantPlan {
  store: GrantStore;
  writeRole: StoredRole | null;
  notify: NotifyKind;
  noChange: boolean;
  error?: GrantErrorCode;
}

export interface RemovePlanInput {
  kind: AccessNodeKind;
  current: PanelRole | null;
  currentRow?: StoredRole | null;
  /** undefined means "do not check"; "none" in the query is null here. */
  expected?: PanelRole | null;
  actorMax: PanelRole | null;
  isObjectOwner?: boolean;
  notepad?: boolean;
  spaceFullOthers?: number;
  targetActive?: boolean;
}

export interface RemovePlan {
  store: GrantStore;
  noChange: boolean;
  previousRole: PanelRole | null;
  error?: GrantErrorCode;
}

const rank = (r: PanelRole | "none" | null | undefined) => PANEL_ROLE_RANK[r ?? "none"];

/**
 * The highest role an actor holding `role` may give on a node of this kind:
 * nothing below the kind's manage bar (Can edit on a doc, Full access
 * elsewhere), the Owner rung on a Space for any Full holder (today's Space
 * ADMIN could), otherwise the highest offered role at or below the actor's
 * own. An Agent shares like anyone else holding the same role, as every
 * sharing gate before node-access let them (A8); the Agent clamp is Phase
 * 8's to decide.
 */
export function maxGrantFor(kind: AccessNodeKind, role: NodeRole): PanelRole | null {
  if (!roleAtLeast(role, MANAGE_BAR[kind])) return null;
  if (kind === "space") return "OWNER";
  const own = role === "OWNER" ? "FULL" : role;
  let best: PanelRole | null = null;
  for (const offered of ROLES_BY_KIND[kind]) {
    if (rank(offered) <= rank(own) && (!best || rank(offered) > rank(best))) best = offered;
  }
  return best;
}

/**
 * The stored value a requested role writes, per kind. A List's two rungs
 * below Can edit are their own values here ("COMMENT", "ASSIGNED"); the row
 * writer stores each as a GUEST role with that rung (grants.ts writeRow), so
 * a change between them and Can view is a change, and a reader that does not
 * know the rung sees Can view.
 */
export function storedRoleFor(kind: AccessNodeKind, requested: PanelRole, currentRow?: StoredRole | null): StoredRole {
  if (kind === "doc") return requested;
  if (kind === "list" && (requested === "COMMENT" || requested === "ASSIGNED")) return requested;
  if (requested === "OWNER") return "OWNER";
  if (requested === "FULL") {
    // A Folder or List OWNER row already reads as Full access: keep it.
    if ((kind === "folder" || kind === "list") && currentRow === "OWNER") return "OWNER";
    return "ADMIN";
  }
  if (requested === "EDIT") return "MEMBER";
  return "GUEST";
}

/** Does this row count toward "a Space needs at least one person with Full access"? */
function isFullRow(row: StoredRole | null | undefined): boolean {
  return row === "OWNER" || row === "ADMIN";
}

const fail = (store: GrantStore, error: GrantErrorCode): GrantPlan => ({ store, writeRole: null, notify: "none", noChange: false, error });

export function planGrant(input: GrantPlanInput): GrantPlan {
  const store = STORE_BY_KIND[input.kind];
  if (input.notepad) return fail(store, "private_note");
  if (!input.actorMax) return fail(store, "forbidden");
  if (!ROLES_BY_KIND[input.kind].includes(input.requested)) return fail(store, "invalid_role");
  if (input.targetInOrg === false) return fail(store, "not_in_org");
  if (input.isObjectOwner) return fail(store, "owner_fixed");
  if (input.expected !== undefined && (input.expected ?? null) !== input.current) return fail(store, "conflict");
  if (rank(input.requested) > rank(input.actorMax)) return fail(store, "above_own_role");
  // An actor may not change a role above what they could give (a Can edit
  // sharer and a Full access listing on a doc).
  if (input.current && rank(input.current) > rank(input.actorMax)) return fail(store, "above_own_role");

  const mode = input.mode ?? "set";
  if (input.current && (input.current === input.requested || (mode === "raise" && rank(input.current) >= rank(input.requested)))) {
    return { store, writeRole: null, notify: "none", noChange: true };
  }

  const writeRole = storedRoleFor(input.kind, input.requested, input.currentRow);
  // Lowering the last active Full row of a Space. Adds and raises never fire.
  if (
    input.kind === "space" &&
    input.targetActive !== false &&
    isFullRow(input.currentRow) &&
    !isFullRow(writeRole) &&
    (input.spaceFullOthers ?? 0) === 0
  ) {
    return fail(store, "last_full");
  }

  let notify: NotifyKind = "none";
  if (!input.self) {
    if (!input.current) notify = "shared";
    else if (rank(input.requested) > rank(input.current)) notify = "upgraded";
  }
  return { store, writeRole, notify, noChange: false };
}

export function planRemove(input: RemovePlanInput): RemovePlan {
  const store = STORE_BY_KIND[input.kind];
  const base = { store, previousRole: input.current };
  if (input.notepad) return { ...base, noChange: false, error: "private_note" };
  if (input.isObjectOwner) return { ...base, noChange: false, error: "owner_fixed" };
  if (!input.actorMax) return { ...base, noChange: false, error: "forbidden" };
  // Removing a row that is not there is a success that changed nothing, so a
  // repeated DELETE (a retry, a second tab) never reads as a failure.
  if (!input.current) return { store, previousRole: null, noChange: true };
  if (input.expected !== undefined && (input.expected ?? null) !== input.current) return { ...base, noChange: false, error: "conflict" };
  if (rank(input.current) > rank(input.actorMax)) return { ...base, noChange: false, error: "above_own_role" };
  if (input.kind === "space" && input.targetActive !== false && isFullRow(input.currentRow) && (input.spaceFullOthers ?? 0) === 0) {
    return { ...base, noChange: false, error: "last_full" };
  }
  return { ...base, noChange: false };
}
