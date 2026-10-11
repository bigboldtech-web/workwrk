// The ONE copy of role labels and blurbs, for every dialog, chip, list and
// API response (spec 1.1 principle 1, spec 3.1). No UI may re-type these.
//
// Pure: imports only ./types.

import type { ObjectRole, OrgRole } from "./types";

export const OBJECT_ROLE_LABEL: Record<ObjectRole, string> = {
  FULL: "Full access",
  EDIT: "Can edit",
  COMMENT: "Can comment",
  VIEW: "Can view",
};

/** Verbatim from spec 3.1. */
export const OBJECT_ROLE_BLURB: Record<ObjectRole, string> = {
  FULL: "Change settings, sharing, delete and transfer.",
  EDIT: "Add and change tasks, docs and rows.",
  COMMENT: "Read and discuss, never change.",
  VIEW: "Read only.",
};

export const ORG_ROLE_LABEL: Record<OrgRole, string> = {
  OWNER: "Owner",
  ADMIN: "Admin",
  MEMBER: "Member",
  GUEST: "Guest",
};

/** Spec 2.1, one line each. */
export const ORG_ROLE_BLURB: Record<OrgRole, string> = {
  OWNER: "Runs the company account: billing, ownership and security.",
  ADMIN: "Runs the workspace day to day.",
  MEMBER: "An employee: works in the Spaces they are added to and sees what is open to the workspace.",
  GUEST: "Outside the company, sees only what is shared.",
};

/**
 * The List ladder's rung between Can comment and Can edit (founder decision 3,
 * docs/plans/competitor-gap-2026-09.md section 7): the role a List share
 * calls "ASSIGNED". It exists on Lists only.
 */
export const ASSIGNED_ROLE_LABEL = "Can edit assigned tasks";
export const ASSIGNED_ROLE_BLURB = "Read and discuss every task, change only tasks assigned to them or that they made.";

/**
 * The three lower rungs on a List, where assignment matters: rules 9 and 5
 * let an assignee and a creator change their task at Can view and at Can edit
 * assigned tasks, never at Can comment held as the person's whole access to
 * the List (src/lib/item-role.ts taskSideOfListRole; with Can view from
 * anywhere else, node-rules listCommentUnion reads it as Can edit assigned
 * tasks, because a share only adds).
 */
export const LIST_ROLE_BLURB = {
  COMMENT: "Read and discuss every task, change none, not even their own, unless they can open the List another way.",
  VIEW: "Read only, except tasks assigned to them or that they made, which they can change.",
} as const;

/** The order every role picker renders, widest first. */
export const OBJECT_ROLE_ORDER: readonly ObjectRole[] = ["FULL", "EDIT", "COMMENT", "VIEW"];
export const ORG_ROLE_ORDER: readonly OrgRole[] = ["OWNER", "ADMIN", "MEMBER", "GUEST"];

/**
 * The Agent tier, in the one sentence every screen that explains it shows:
 * the invite dialog's "This is an agent account" box, the Members drawer's
 * Tier row and the Who can do what page. The tier is User.accessLevel AGENT,
 * a Member with the Agent flag (spec 2.1 and 2.4, decision D13): a person on
 * frontline work, never a bot or a service. An AI teammate holds no tier of
 * its own; it acts as the person who runs it (src/lib/agents/acting.ts).
 *
 * Every claim is one the server enforces for every Agent
 * (agent-tier.contract.test.ts holds them):
 *   - never deletes a task: item-role.ts allowsItemAction, whatever the
 *     level, and never a List, Folder or Space that holds one
 *     (container-trash.ts; an empty one may go, archiving stays open)
 *   - never creates a Space: space-create.ts (the manager tier), the
 *     engine's create_space verb (resolve.ts), and a Space's Duplicate
 *     (POST /api/spaces/[id]/duplicate), all in AGENT_NO_SPACES's words
 *   - never anyone's manager: checkManagerCandidate (PATCH /api/users/[id],
 *     bulk update, bulk import, dotted lines), an invitation's Reports to
 *     (sendInvitation, and managerOnAccept when it is accepted), never made
 *     an Agent while anyone reports to them (membership.ts rule 6), and a
 *     handover to an Agent sends the reports up instead (planReportHandover)
 *   - "most exports": every export route refuses an Agent, or is Admin
 *     only, except the four that hand a person their own records back (their
 *     meetings and their own timesheet weeks at /api/export/[type], Download
 *     my data, and their calendar files), so the sentence never says all.
 * It leaves out "never holds Full access": the share dialogs for tools, SOP
 * folders, teams and goals clamp an Agent to Can edit, but the Space, Folder
 * and List rules do not yet (node-rules.ts moveVerdict, A8), so an Agent who
 * owns a List still manages it.
 */
export const AGENT_TIER_BLURB =
  "For frontline staff, such as support, warehouse or field teams. An Agent works as a Member but can't delete tasks, create Spaces or be anyone's manager, and most exports are closed to them.";

/**
 * The engine's words for an Agent creating a Space (resolve.ts decideOrg
 * create_space), for every door that refuses it outside the engine: POST
 * /api/spaces, a Space template, and a Space's Duplicate.
 */
export const AGENT_NO_SPACES = "Agents never create spaces.";

/**
 * An Agent deleting a List, Folder or Space that still holds tasks: the
 * tasks would go with it, and an Agent never deletes a task (resolve.ts rule
 * 12, "Agents never delete"). An empty one may go; archiving keeps every
 * task, so it stays open to them.
 */
export function agentTrashRefusal(kind: "List" | "Folder" | "Space", tasks: number): string {
  const held = tasks === 1 ? "1 task" : `${tasks} tasks`;
  return `This ${kind} holds ${held}, and an Agent can't delete tasks. Archive it instead, or ask someone else with Full access to delete it.`;
}
