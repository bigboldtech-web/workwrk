// "Who can do what": the read-only permission matrix on Settings, Access
// (founder decision 3, docs/plans/competitor-gap-2026-09.md section 7: "a
// read-only permission matrix page", for an admin to screenshot for a
// security review).
//
// EVERY CELL OF THE LIST TABLE IS WORKED OUT BY THE CODE THAT ENFORCES IT,
// never typed by hand: the task cells by decideItem and allowsItemAction (the
// task gate's own functions, src/lib/item-role.ts), the List cells by the
// rank rules the List routes use (roleAtLeast, MANAGE_BAR). So the page
// cannot drift from the product: change a rule and the matrix changes with
// it, and permission-matrix.test.ts holds every cell to the gate.
//
// The rules and workspace tables are the relationship rules and org roles,
// stated with the rule each one is (node-rules R1, item-role rules 4 to 12),
// kept beside the code that decides them.
//
// Pure: no database, so it runs on the page and in the tests.

import { MANAGE_BAR, ROLES_BY_KIND, panelRoleBlurb, panelRoleLabel, type PanelRole } from "./access-panel";
import { roleAtLeast } from "./node-rules";
import { allowsItemAction, decideItem, taskSideOfListRole, type ItemAction } from "../item-role";

/** yes; no; only the tasks assigned to them; only the tasks they made; the tasks assigned to them or made by them. */
export type MatrixCell = "yes" | "no" | "assigned" | "own" | "assignedOrOwn";

export interface MatrixColumn {
  role: PanelRole;
  label: string;
  blurb: string;
}

export interface MatrixRow {
  key: string;
  label: string;
  cells: MatrixCell[];
}

export interface PermissionMatrix {
  columns: MatrixColumn[];
  rows: MatrixRow[];
}

const BASE = { orgAdmin: false, guest: false, archived: false } as const;

/**
 * What a holder of `role` on a List may do to a task in it: to any task, to
 * one assigned to them, or to one they made. A task they made is asked at
 * every rung, not only where tasks can be added: someone lowered after making
 * tasks, or whose task was moved into the List, is still its creator.
 */
export function taskCell(role: PanelRole, action: ItemAction): MatrixCell {
  const side = taskSideOfListRole(role);
  const may = (assignee: boolean, creator: boolean) =>
    allowsItemAction(decideItem({ ...BASE, ...side, assignee, creator }), action, { creator });
  if (may(false, false)) return "yes";
  const assigned = may(true, false);
  const made = may(false, true);
  if (assigned && made) return "assignedOrOwn";
  if (assigned) return "assigned";
  if (made) return "own";
  return "no";
}

const yesNo = (v: boolean): MatrixCell => (v ? "yes" : "no");

/** The List table: the five rungs a List share offers, widest first. */
export function listMatrix(): PermissionMatrix {
  const roles = ROLES_BY_KIND.list;
  const columns = roles.map((role) => ({ role, label: panelRoleLabel(role), blurb: panelRoleBlurb("list", role) }));
  const row = (key: string, label: string, cell: (role: PanelRole) => MatrixCell): MatrixRow => ({ key, label, cells: roles.map(cell) });
  return {
    columns,
    rows: [
      row("read", "Open the List and read every task", (r) => taskCell(r, "view")),
      row("comment", "Comment and react on tasks", (r) => taskCell(r, "comment")),
      row("edit", "Change a task: title, status, dates, people, fields", (r) => taskCell(r, "edit")),
      row("archive", "Move a task to Trash", (r) => taskCell(r, "archive")),
      row("delete", "Delete a task for good", (r) => taskCell(r, "delete")),
      // Adding to the List, arranging it and saving its views are List-level
      // writes: Can edit on the List (canContributeBoard).
      row("add", "Add tasks and subtasks", (r) => yesNo(roleAtLeast(r, "EDIT"))),
      row("arrange", "Reorder tasks and save views", (r) => yesNo(roleAtLeast(r, "EDIT"))),
      // Statuses, fields and the List's own settings: Full access (canEditBoard).
      row("manage", "Change statuses, fields and List settings", (r) => yesNo(roleAtLeast(r, "FULL"))),
      // Sharing: the List's manage bar (access-panel MANAGE_BAR).
      row("share", "Share the List and change who can open it", (r) => yesNo(roleAtLeast(r, MANAGE_BAR.list))),
    ],
  };
}

export interface MatrixRule {
  key: string;
  who: string;
  gets: string;
}

/**
 * Rules that add to (or cap) what a List share gives, as the gates apply them.
 * The page is for a customer's security review, so the words name what
 * people see; the rule each one is stays here.
 */
export const RELATIONSHIP_RULES: readonly MatrixRule[] = [
  // item-role rule 9, withheld by taskSideOfListRole at Can comment.
  { key: "assignee", who: "Someone a task is assigned to", gets: "Can edit on that task, unless Can comment on its List is all the access they hold there." },
  // item-role rule 5, withheld the same way.
  { key: "creator", who: "The person who made a task", gets: "Full access on that task, unless Can comment on its List is all the access they hold there." },
  // node-rules listCommentUnion: a share only adds.
  {
    key: "union",
    who: "Someone with Can comment who can also open the List another way",
    gets: "Can edit assigned tasks. A share only adds, so it never takes away what the Space, a Folder or the whole company already gives.",
  },
  // Assigning is an edit of the task (items PATCH, gated at Can edit), and rule 9 opens the task to the new assignee.
  { key: "assigning", who: "Anyone who can change a task", gets: "Can assign it to anyone in the workspace, which opens that task to them." },
  // node-rules R1 and R6a.
  { key: "admin", who: "Workspace Owners and Admins", gets: "Full access on every Space, Folder, List, task, Doc and table, never on someone's personal notes." },
  // node-rules R3 and R4: the owner rule reaches through the parent unless the node is Private.
  { key: "owner", who: "The owner of a Folder or List", gets: "Full access on it while they can open the Space or Folder it sits in, and always on a Private one." },
  // List links (Phase 5b): a linked reader gets view; the home List decides changes.
  { key: "linked", who: "Readers of another List a task is added to", gets: "Can view on that task. Whether they can change it is decided by the List it lives in." },
  // node-rules R4.
  { key: "inherit", who: "Members of a Space or Folder", gets: "The same level on the Lists inside it, unless a List is Private." },
  // item-role rule 12.
  { key: "trash", who: "Anyone on a task in Trash", gets: "Can view at most, unless they hold Full access. Someone with Can edit may still restore it." },
  // item-role rule 12.
  { key: "agent", who: "An AI agent", gets: "Never deletes a task, whatever its level." },
];

/** The workspace roles, as the workspace-level gates read them. */
export const WORKSPACE_ROLES: readonly { role: string; summary: string }[] = [
  { role: "Owner", summary: "Runs the company account: billing, ownership and security. Opens everything an Admin does." },
  { role: "Admin", summary: "Runs the workspace: every Settings page, inviting people, exporting the workspace, and Full access on all work except personal notes." },
  { role: "Member", summary: "Works in what they are added to or what is open to the whole workspace, at the level they were given." },
  { role: "Agent", summary: "An AI teammate: works at the level it was given, never deletes a task and never exports." },
];
