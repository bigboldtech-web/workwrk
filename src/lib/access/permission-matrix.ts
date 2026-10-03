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

/** yes; no; only the tasks assigned to them; only the tasks they made. */
export type MatrixCell = "yes" | "no" | "assigned" | "own";

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

/** What a holder of `role` on a List may do to a task in it: to any task, to one assigned to them, or to one they made. */
export function taskCell(role: PanelRole, action: ItemAction): MatrixCell {
  const side = taskSideOfListRole(role);
  const any = decideItem({ ...BASE, ...side, assignee: false, creator: false });
  if (allowsItemAction(any, action, { creator: false })) return "yes";
  const assigned = decideItem({ ...BASE, ...side, assignee: true, creator: false });
  if (allowsItemAction(assigned, action, { creator: false })) return "assigned";
  // A task they made: only someone who may add tasks here ever makes one.
  if (roleAtLeast(role, "EDIT")) {
    const made = decideItem({ ...BASE, ...side, assignee: false, creator: true });
    if (allowsItemAction(made, action, { creator: true })) return "own";
  }
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

/** Rules that add to (or cap) what a List share gives, as the gates apply them. */
export const RELATIONSHIP_RULES: readonly MatrixRule[] = [
  { key: "assignee", who: "Someone a task is assigned to", gets: "Can edit on that task, at every level except Can comment (item-role rule 9)." },
  { key: "creator", who: "The person who made a task", gets: "Full access on that task (rule 5)." },
  { key: "admin", who: "Workspace Owners and Admins", gets: "Full access on every Space, Folder, List, task, Doc and table, never on someone's personal notes (node-rules R1 and R6a)." },
  { key: "owner", who: "The owner of a Folder or List", gets: "Full access on it (node-rules R3 and R4)." },
  { key: "linked", who: "Readers of a List a task is added to", gets: "Can view on that task. Changing it is still decided by its home List (Phase 5b)." },
  { key: "inherit", who: "Members of a Space or Folder", gets: "The same level on the Lists inside it, unless a List is Private (node-rules R4)." },
  { key: "trash", who: "Anyone on a task in Trash", gets: "Can view at most, unless they hold Full access; Can edit may still restore it (rule 12)." },
  { key: "agent", who: "An AI agent", gets: "Never deletes a task, whatever its level (rule 12)." },
];

/** The workspace roles, as the workspace-level gates read them. */
export const WORKSPACE_ROLES: readonly { role: string; summary: string }[] = [
  { role: "Owner", summary: "Runs the company account: billing, ownership and security. Opens everything an Admin does." },
  { role: "Admin", summary: "Runs the workspace: every Settings page, inviting people, exporting the workspace, and Full access on all work except personal notes." },
  { role: "Member", summary: "Works in what they are added to or what is open to the whole workspace, at the level they were given." },
  { role: "Agent", summary: "An AI teammate: works at the level it was given, never deletes a task and never exports." },
];
