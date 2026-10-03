// The activity rows a change to who can open a node writes.
//
// grants.ts writes one ActivityLog row per grant change, per visibility or
// restricted change and per public link switch, inside the same transaction
// as the change itself, wherever the product records security activity
// today (ActivityLog, read by /api/audit and Settings > Admin > Audit).
//
// THE DESCRIPTION NAMES ONLY THE NOUN. ActivityLog.description is printed on
// feeds that other people read, so it never carries a person's name, an
// email or an id: "Gave someone access to a Folder". Who and what live in
// metadata as ids (nodeKind, nodeId, granteeId, role, previousRole), where
// only the audit surfaces read them: GET /api/audit resolves them to names
// for the auditor and accessAuditSentence below writes the line Settings >
// Audit shows ("Gave Access Two Can edit on the Doc Plan"). The feeds that are not audit surfaces
// (the home dashboard, the AI context, the team work view) exclude
// ACCESS_ACTIVITY_TYPES entirely.
//
// Pure: imports ./access-panel and ../activity-targets only.

import { ACCESS_NODE_NOUN, panelRoleLabel, type AccessNodeKind, type PanelRole } from "./access-panel";
import { normaliseTargetType } from "../activity-targets";

export const ACCESS_ACTIVITY_TYPES = [
  "access.granted",
  "access.role_changed",
  "access.revoked",
  "access.visibility_changed",
  "access.restricted_changed",
  "access.public_link.on",
  "access.public_link.off",
  // A task's public link: its expiry or whether it shows people (src/lib/task-public-link.ts).
  "access.public_link.changed",
  "access.private_rule_changed",
  "access.invited",
] as const;

export type AccessActivityType = (typeof ACCESS_ACTIVITY_TYPES)[number];

export function isAccessActivityType(type: string | null | undefined): type is AccessActivityType {
  return !!type && (ACCESS_ACTIVITY_TYPES as readonly string[]).includes(type);
}

/** ActivityLog.targetType per node kind, in the keys src/lib/activity-targets.ts resolves. */
export const ACTIVITY_TARGET_TYPE: Readonly<Record<AccessNodeKind, string>> = {
  space: "space",
  folder: "folder",
  list: "list",
  doc: "doc",
  table: "data_table",
  canvas: "whiteboard",
  form: "form_definition",
};

const withArticle = (noun: string) => `${/^[AEIOU]/.test(noun) ? "an" : "a"} ${noun}`;

/** The one sentence an access row carries: the kind of change and the noun, nothing else. */
export function accessActivityDescription(type: AccessActivityType, kind: AccessNodeKind | null): string {
  const noun = kind ? withArticle(ACCESS_NODE_NOUN[kind]) : "a node";
  switch (type) {
    case "access.granted":
      return `Gave someone access to ${noun}`;
    case "access.role_changed":
      return `Changed someone's access to ${noun}`;
    case "access.revoked":
      return `Removed someone's access to ${noun}`;
    case "access.visibility_changed":
    case "access.restricted_changed":
      return `Changed who can open ${noun}`;
    case "access.public_link.on":
      return `Turned on the public link of ${noun}`;
    case "access.public_link.off":
      return `Turned off the public link of ${noun}`;
    case "access.public_link.changed":
      return `Changed the public link of ${noun}`;
    case "access.private_rule_changed":
      return "Changed the rule for Private items in this workspace";
    case "access.invited":
      return `Invited someone by email to ${noun}`;
  }
}

/**
 * The activity targetTypes that name a node of the one access model, in the
 * normalised keys of src/lib/activity-targets.ts (the app writes several
 * spellings: "board" and "list", "doc" and "note", "table" and "data_table").
 */
const NODE_KIND_BY_TARGET: Readonly<Record<string, AccessNodeKind>> = {
  space: "space",
  folder: "folder",
  list: "list",
  board: "list",
  doc: "doc",
  note: "doc",
  data_table: "table",
  table: "table",
  whiteboard: "canvas",
  canvas: "canvas",
  form_definition: "form",
  form: "form",
};

/** The node an activity row points at, or null when its target is not a node (a task, a person, a setting). */
export function activityNodeRef(targetType: string | null | undefined, targetId: string | null | undefined): { kind: AccessNodeKind; id: string } | null {
  if (!targetId) return null;
  const kind = NODE_KIND_BY_TARGET[normaliseTargetType(targetType)];
  return kind ? { kind, id: targetId } : null;
}

// ── the audit line ───────────────────────────────────────────────────

const STORED_ROLE_LABEL: Readonly<Record<string, PanelRole>> = {
  // SpaceMember, FolderMember, BoardMember and AccessGrant rows.
  ADMIN: "FULL",
  MEMBER: "EDIT",
  GUEST: "VIEW",
  // Doc listings and the panel's own words.
  FULL: "FULL",
  EDIT: "EDIT",
  COMMENT: "COMMENT",
  // The List ladder's rung between Can comment and Can edit.
  ASSIGNED: "ASSIGNED",
  VIEW: "VIEW",
  // The legacy doc listing words.
  edit: "EDIT",
  view: "COMMENT",
};

/**
 * A stored role as the dialog words it. OWNER reads as Owner on a Space and
 * as Full access on a Folder or List, where the row means the same as ADMIN.
 */
export function auditRoleLabel(stored: string | null | undefined, kind: AccessNodeKind | null): string | null {
  if (!stored) return null;
  if (stored === "OWNER") return kind === "space" ? panelRoleLabel("OWNER") : panelRoleLabel("FULL");
  const role = STORED_ROLE_LABEL[stored];
  return role ? panelRoleLabel(role) : null;
}

/** The general access values a visibility or restricted row stores, in the dialog's words. */
const GENERAL_LABEL: Readonly<Record<string, string>> = {
  PRIVATE: "Restricted",
  WORKSPACE: "inherited",
  ORG: "everyone at the organization",
  restricted: "Restricted",
  open: "not restricted",
};

/** A Space's three settings, as SpaceVisibilityControl names them. */
const SPACE_GENERAL_LABEL: Readonly<Record<string, string>> = {
  PRIVATE: "invite only",
  WORKSPACE: "Space members",
  ORG: "everyone at the organization",
};

export interface AccessAuditFacts {
  kind: AccessNodeKind | null;
  /** The noun for a target that is not a node (a task's public link): "task". Absent reads "item". */
  noun?: string | null;
  /** The node's name, or null when the auditor cannot open it (it is then named by its noun only). */
  nodeName: string | null;
  /** The person given or losing access; null on a change that is not about one person. */
  granteeName: string | null;
  role: string | null;
  previousRole: string | null;
}

/**
 * The Settings > Audit line for one access row: who got or lost what, on
 * which node. Only the audit surface prints it; the description the row
 * carries stays name free for every other feed.
 */
export function accessAuditSentence(type: AccessActivityType, f: AccessAuditFacts): string {
  const noun = f.kind ? ACCESS_NODE_NOUN[f.kind] : f.noun || "item";
  const node = f.nodeName ? `the ${noun} ${f.nodeName}` : withArticle(noun);
  const who = f.granteeName ?? "someone";
  const role = auditRoleLabel(f.role, f.kind);
  const prev = auditRoleLabel(f.previousRole, f.kind);
  switch (type) {
    case "access.granted":
      return role ? `Gave ${who} ${role} on ${node}` : `Gave ${who} access to ${node}`;
    case "access.role_changed":
      return prev && role ? `Changed ${who} from ${prev} to ${role} on ${node}` : `Changed ${who}'s access to ${node}`;
    case "access.revoked":
      return prev ? `Removed ${who} (${prev}) from ${node}` : `Removed ${who}'s access to ${node}`;
    case "access.visibility_changed":
    case "access.restricted_changed":
    {
      const words = f.kind === "space" ? SPACE_GENERAL_LABEL : GENERAL_LABEL;
      return f.previousRole && f.role && words[f.previousRole] && words[f.role]
        ? `Changed who can open ${node} from ${words[f.previousRole]} to ${words[f.role]}`
        : `Changed who can open ${node}`;
    }
    case "access.public_link.on":
      return `Turned on the public link of ${node}`;
    case "access.public_link.off":
      return `Turned off the public link of ${node}`;
    case "access.public_link.changed":
      return `Changed the public link of ${node}`;
    case "access.private_rule_changed":
      return accessActivityDescription(type, null);
    case "access.invited":
      return role ? `Invited ${who} by email as ${role} to ${node}` : `Invited ${who} by email to ${node}`;
  }
}
