// The Manage access vocabulary the API and the dialog share: the node kinds,
// the roles each kind offers, where a person's access comes from, and the
// payloads of GET /api/access/:kind/:id and its grants writes.
// Pure: imports ./types and ./labels only, so the UI and vitest load it with
// no database.

import type { ObjectRole } from "./types";
import { ASSIGNED_ROLE_BLURB, ASSIGNED_ROLE_LABEL, LIST_ROLE_BLURB, OBJECT_ROLE_BLURB, OBJECT_ROLE_LABEL } from "./labels";

export type AccessNodeKind = "space" | "folder" | "list" | "doc" | "table" | "canvas" | "form";

export const ACCESS_NODE_KINDS: readonly AccessNodeKind[] = ["space", "folder", "list", "doc", "table", "canvas", "form"];

export function isAccessNodeKind(s: string): s is AccessNodeKind {
  return (ACCESS_NODE_KINDS as readonly string[]).includes(s);
}

/**
 * The objects the one dialog serves beside the nodes (batch 7, access-model
 * spec section 6.1), each over the store it already reads: SOPFolderAccess,
 * ToolShare, the goal's GoalAssignee rows and TeamMember. Served only while
 * ACCESS_V2_TABLES is on (src/lib/access/object-share): the node kinds above
 * are never widened, because they drive node-access.
 */
export type ObjectShareKind = "sop_folder" | "tool" | "goal" | "team";

export const OBJECT_SHARE_KINDS: readonly ObjectShareKind[] = ["sop_folder", "tool", "goal", "team"];

export function isObjectShareKind(s: string): s is ObjectShareKind {
  return (OBJECT_SHARE_KINDS as readonly string[]).includes(s);
}

/** Every kind the one dialog can open. */
export type ShareKind = AccessNodeKind | ObjectShareKind;

export const ACCESS_NODE_NOUN: Readonly<Record<ShareKind, string>> = {
  space: "Space", folder: "Folder", list: "List", doc: "Doc", table: "Table", canvas: "Canvas", form: "Form",
  sop_folder: "SOP folder", tool: "Tool", goal: "Goal", team: "Team",
};

/**
 * A role as the dialog offers it. OWNER exists on Spaces only: Full access
 * plus every Private List in the Space (a SpaceMember OWNER row). ASSIGNED
 * exists on Lists only: Can edit assigned tasks, between Can comment and Can
 * edit (a BoardMember GUEST row with the rung "ASSIGNED").
 */
export type PanelRole = ObjectRole | "OWNER" | "ASSIGNED";

/**
 * ASSIGNED ranks between COMMENT and EDIT, so every comparison keeps its
 * meaning: it reads and comments like Can comment and never clears an EDIT
 * floor (no List-level write), and only the task gate gives it more, on the
 * tasks assigned to the member.
 */
export const PANEL_ROLE_RANK: Readonly<Record<PanelRole | "none", number>> = { none: 0, VIEW: 1, COMMENT: 2, ASSIGNED: 2.5, EDIT: 3, FULL: 4, OWNER: 5 };

export function panelAtLeast(role: PanelRole | "none", floor: PanelRole): boolean {
  return PANEL_ROLE_RANK[role] >= PANEL_ROLE_RANK[floor];
}

export const ROLES_BY_KIND: Readonly<Record<ShareKind, readonly PanelRole[]>> = {
  space: ["OWNER", "FULL", "EDIT", "VIEW"],
  folder: ["FULL", "EDIT", "VIEW"],
  list: ["FULL", "EDIT", "ASSIGNED", "COMMENT", "VIEW"],
  doc: ["FULL", "EDIT", "COMMENT", "VIEW"],
  table: ["FULL", "EDIT"],
  canvas: ["FULL", "EDIT", "VIEW"],
  form: ["FULL", "EDIT", "VIEW"],
  // SOPFolderAccess OWNER / EDITOR / VIEWER. No comments live on a folder.
  sop_folder: ["FULL", "EDIT", "VIEW"],
  // A tool has no comments, so no Can comment (ToolShare.role).
  tool: ["FULL", "EDIT", "VIEW"],
  // A GoalAssignee row has no role: every one sees the goal and checks in.
  goal: ["EDIT"],
  // A TeamMember row is a member or, with its lead flag, a lead.
  team: ["FULL", "VIEW"],
};

/**
 * Who may change who has access: Can edit on a doc (today's doc sharing
 * rule) and on a goal (mayEditGoal), Full access on every other kind.
 */
export const MANAGE_BAR: Readonly<Record<ShareKind, ObjectRole>> = {
  space: "FULL", folder: "FULL", list: "FULL", doc: "EDIT", table: "FULL", canvas: "FULL", form: "FULL",
  sop_folder: "FULL", tool: "FULL", goal: "EDIT", team: "FULL",
};

export function panelRoleLabel(role: PanelRole): string {
  if (role === "OWNER") return "Owner";
  if (role === "ASSIGNED") return ASSIGNED_ROLE_LABEL;
  return OBJECT_ROLE_LABEL[role];
}

/** A role in the words of its kind: a goal's one role and a team's two are not the ladder's. */
export function shareRoleLabel(kind: ShareKind, role: PanelRole): string {
  if (kind === "goal" && role === "EDIT") return "Can check in";
  if (kind === "team" && role === "FULL") return "Lead";
  if (kind === "team" && role === "VIEW") return "Member";
  return panelRoleLabel(role);
}

const OBJECT_BLURB: Readonly<Record<ObjectShareKind, Partial<Record<PanelRole, string>>>> = {
  sop_folder: {
    FULL: "Write its SOPs and change who can open the folder.",
    EDIT: "Read and write its SOPs, drafts included.",
    VIEW: "Read its published SOPs.",
  },
  tool: {
    FULL: "Change the tool and its saved login, share it and delete it.",
    EDIT: "Change the tool and its saved login.",
    VIEW: "See the tool and use its saved login.",
  },
  goal: {
    EDIT: "See the goal and check in on its targets. Never rename, delete or share it.",
  },
  team: {
    FULL: "On the team. A lead who can open Members adds and takes off its members.",
    VIEW: "On the team.",
  },
};

export function panelRoleBlurb(kind: ShareKind, role: PanelRole): string {
  if (isObjectShareKind(kind)) {
    const own = OBJECT_BLURB[kind][role];
    if (own) return own;
  }
  if (role === "OWNER") return "Full access, plus every Private List in this Space.";
  if (role === "ASSIGNED") return ASSIGNED_ROLE_BLURB;
  if (kind === "list" && (role === "COMMENT" || role === "VIEW")) return LIST_ROLE_BLURB[role];
  if (kind === "doc" && role === "EDIT") return "Edit this doc and change who can open it.";
  if (kind === "doc" && role === "FULL") return "Also lock it, move it to Trash and save it as a template.";
  return OBJECT_ROLE_BLURB[role];
}

export interface AccessPerson { id: string; name: string; email: string; avatar: string | null; active: boolean }

/** Where a person's access comes from, in words the viewer may see. A container the viewer cannot open is never named: it is "hidden". */
export type AccessVia =
  | { type: "node"; kind: ShareKind; id: string; name: string; href: string | null; canManage: boolean }
  | { type: "hidden" }
  | { type: "everyone"; orgName: string; from: { kind: ShareKind; name: string } | null }
  | { type: "org_admin"; orgName: string }
  | { type: "owner" }
  | { type: "older_rule"; from: { kind: ShareKind; name: string } | null }
  /**
   * A live rule that is not a place, on the objects served beside the nodes
   * (a goal's department, job title or tag audience, the owner's managers):
   * its words, read only ("as a member of Engineering").
   */
  | { type: "rule"; text: string };

export type AccessGrantSource =
  | "SpaceMember" | "FolderMember" | "BoardMember" | "AccessGrant" | "DocSharing" | "DocSharingLegacy" | "Owner"
  | "SOPFolderAccess" | "ToolShare" | "GoalAssignee" | "TeamMember";

export interface AccessDirectEntry {
  person: AccessPerson;
  role: PanelRole;
  owner: boolean;
  source: AccessGrantSource;
  editable: boolean;
  removable: boolean;
  lastFull: boolean;
  /** A doc listing made before this release: it limits the person to this role even where a container gives more, as it does today. */
  cap: boolean;
  /**
   * The role they reach the node at another way, when it is higher than their
   * own row. `plusOwnComment`: a List's union (their own Can comment row plus
   * Can view this other way give Can edit assigned tasks together).
   */
  alsoVia: { role: PanelRole; via: AccessVia; plusOwnComment?: boolean } | null;
  /**
   * What else decides what this person can do here, when the role alone would
   * mislead: on an SOP folder, a workspace role that cannot edit SOPs. Read
   * only. Absent on the node kinds.
   */
  note?: string;
}

export interface AccessInheritedEntry {
  person: AccessPerson;
  role: PanelRole;
  via: AccessVia;
  /** As on a direct row: what else decides what they can do (an SOP folder's workspace-role caveat). */
  note?: string;
}

export interface AccessGeneral {
  visibility: "PRIVATE" | "WORKSPACE" | "ORG" | null;
  restricted: boolean | null;
  /** Docs, tables and forms. url is present only for people who can change it. */
  publicLink: { on: boolean; allowed: boolean; url: string | null } | null;
  /** The node sits in an org-wide Space: a share here adds rights and cannot hide the rest of that Space. */
  orgWideSpace: { id: string; name: string } | null;
  privateRule: "legacy" | "strict";
  /**
   * A Folder or List: the container it inherits from when it is not
   * Restricted, its parent Folder or its Space. Named because the viewer can
   * open the node, so its path is theirs to see. Absent from an older server.
   */
  inheritsFrom?: { kind: "space" | "folder"; id: string; name: string } | null;
  /**
   * The nearest Restricted Folder above a Folder, List, doc or canvas: only
   * the people who can open it inherit anything below it, whatever the
   * nearer containers say.
   */
  restrictedAbove?: { id: string; name: string } | null;
  /**
   * A doc that is not Restricted yet: would the viewer still open it once it
   * is? Only its listed people, the person who made it and Admins keep a
   * Restricted doc, so a manager who reaches it only through its place would
   * lock themselves out. Absent on other kinds and from an older server.
   */
  viewerKeepsIfRestricted?: boolean;
}

export interface AccessPanel {
  node: {
    kind: ShareKind;
    id: string;
    name: string;
    noun: string;
    href: string;
    space: { id: string; name: string; slug: string; href: string } | null;
    /** Set on a private note: only its owner can open it, and nothing here changes that. */
    notepadOwner: AccessPerson | null;
  };
  viewer: { role: PanelRole | "none"; canManage: boolean; maxGrant: PanelRole | null; isAgent: boolean };
  roles: readonly PanelRole[];
  general: AccessGeneral;
  /** Owner first, then by PANEL_ROLE_RANK descending, then name. */
  direct: AccessDirectEntry[];
  /** Nearest ancestor first. */
  inherited: AccessInheritedEntry[];
  inheritedMore: Array<{ via: AccessVia; more: number }>;
  hiddenInherited: Array<{ kind: ShareKind; name: string }>;
  everyone: { role: PanelRole; via: AccessVia } | null;
  admins: { count: number } | null;
  /**
   * Rules that decide access here and are no one's row, in plain words: who
   * always sees every SOP folder or tool, a goal's level and audiences. Read
   * only. Absent on the node kinds.
   */
  notes?: string[];
  orgName: string;
  grantsAvailable: boolean;
}

export interface GrantWriteBody { userId: string; role: PanelRole; expected?: PanelRole | null; mode?: "set" | "raise" }

export type GrantErrorCode =
  | "not_found" | "forbidden" | "invalid_body" | "invalid_role" | "not_in_org" | "owner_fixed"
  | "last_full" | "above_own_role" | "private_note" | "conflict" | "grants_unavailable" | "server_error";

export const GRANT_ERROR_MESSAGE: Readonly<Record<GrantErrorCode, string>> = {
  not_found: "This is not there any more, or you cannot open it.",
  forbidden: "You cannot change who can open this.",
  invalid_body: "That request was not understood.",
  invalid_role: "That role is not offered here.",
  not_in_org: "That person is not in this organization.",
  owner_fixed: "The person who made this always keeps Full access.",
  last_full: "A Space needs at least one person with Full access.",
  above_own_role: "You can give at most the access you hold.",
  private_note: "This is a private note. Only its owner can open it.",
  conflict: "Someone else just changed this person's access. Check the list and try again.",
  grants_unavailable: "Adding people to this is not available on this server yet.",
  server_error: "Could not save. Your changes are kept.",
};

export interface GrantErrorBody { error: GrantErrorCode; message: string; detail?: string; panel?: AccessPanel | null }

export interface GrantChange {
  userId: string;
  role: PanelRole | null;
  previousRole: PanelRole | null;
  noChange: boolean;
  stillReaches: { role: PanelRole; via: AccessVia } | null;
  keepsInside: Array<{ kind: AccessNodeKind; id: string; name: string; role: PanelRole }>;
}

export interface GrantWriteResult { panel: AccessPanel | null; change: GrantChange }
