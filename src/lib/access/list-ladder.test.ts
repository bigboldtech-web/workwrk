// The List ladder's two rungs below Can edit (founder decision 3,
// docs/plans/competitor-gap-2026-09.md section 7: "edit only assigned rows;
// comment only"), end to end through the pure pieces:
//
//   storage   a GUEST row plus "BoardMember"."rung" (grant-plan, node-rules)
//   resolve   the List reads Can comment or Can edit assigned tasks, and the
//             legacy floor (which sees only the GUEST row) never lifts it
//   task      Can edit assigned tasks lifts an assignee to Can edit; Can
//             comment never does (item-role taskSideOfListRole, decideItem)
//   rows      a List view opens a row to the viewer it is assigned to only
//             where the lift applies (list-link-rows assignedRowEditable)

import { describe, expect, it } from "vitest";
import {
  NodeEvaluator,
  boardMemberToRole,
  emptyGrants,
  emptyRows,
  isListRung,
  roleAtLeast,
  type ListRung,
  type MemberRole,
  type NodeRef,
  type NodeRole,
  type NodeRows,
  type NodeViewer,
  type ViewerGrants,
} from "./node-rules";
import { PANEL_ROLE_RANK, ROLES_BY_KIND, panelRoleBlurb, panelRoleLabel } from "./access-panel";
import { planGrant, storedRoleFor } from "./grant-plan";
import { allowsItemAction, decideItem, taskSideOfListRole } from "../item-role";
import { assignedRowEditable } from "../list-link-rows";
import type { BoardItemRow } from "../board-items-shared";

const ORG = "org-1";
const ME = "u-me";
const OTHER = "u-other";
const CUTOFF = Date.UTC(2026, 8, 25);

function viewer(): NodeViewer {
  return { userId: ME, orgAdmin: false, orgGuest: false, isAgent: false, denied: false };
}

function world(): { rows: NodeRows; g: ViewerGrants } {
  const rows = emptyRows(ORG, "legacy");
  rows.legacyBefore = CUTOFF;
  rows.spaces.set("s", { id: "s", organizationId: ORG, name: "s", slug: "s", icon: null, color: null, visibility: "WORKSPACE", ownerId: OTHER });
  rows.lists.set("l", { id: "l", organizationId: ORG, spaceId: "s", folderId: null, name: "l", slug: "l", icon: null, color: null, visibility: "WORKSPACE", ownerId: OTHER });
  const g = emptyGrants(viewer());
  g.since = new Map();
  return { rows, g };
}

function listRole(row: MemberRole, rung: ListRung | null, at: number): NodeRole {
  const { rows, g } = world();
  g.list.set("l", row);
  if (rung) (g.listRung ??= new Map()).set("l", rung);
  g.since!.set("list:l", at);
  const ref: NodeRef = { kind: "list", id: "l" };
  return new NodeEvaluator(rows, g).effective(ref).role;
}

describe("the List ladder: what a share offers and stores", () => {
  it("offers five rungs on a List and keeps the other kinds as they were", () => {
    expect(ROLES_BY_KIND.list).toEqual(["FULL", "EDIT", "ASSIGNED", "COMMENT", "VIEW"]);
    expect(ROLES_BY_KIND.folder).toEqual(["FULL", "EDIT", "VIEW"]);
    expect(ROLES_BY_KIND.space).toEqual(["OWNER", "FULL", "EDIT", "VIEW"]);
    expect(panelRoleLabel("ASSIGNED")).toBe("Can edit assigned tasks");
    expect(panelRoleLabel("COMMENT")).toBe("Can comment");
    expect(panelRoleBlurb("list", "COMMENT")).toMatch(/never change one, even one assigned to them/);
    expect(panelRoleBlurb("list", "VIEW")).toMatch(/except a task assigned to them/);
    expect(panelRoleBlurb("doc", "COMMENT")).toBe("Read and discuss, never change.");
  });

  it("ranks Can edit assigned tasks between Can comment and Can edit, so no Can edit floor ever clears it", () => {
    expect(PANEL_ROLE_RANK.COMMENT).toBeLessThan(PANEL_ROLE_RANK.ASSIGNED);
    expect(PANEL_ROLE_RANK.ASSIGNED).toBeLessThan(PANEL_ROLE_RANK.EDIT);
    expect(roleAtLeast("ASSIGNED", "EDIT")).toBe(false);
    expect(roleAtLeast("ASSIGNED", "COMMENT")).toBe(true);
    expect(roleAtLeast("ASSIGNED", "VIEW")).toBe(true);
  });

  it("stores each rung as its own value, written as a GUEST row with that rung", () => {
    expect(storedRoleFor("list", "COMMENT")).toBe("COMMENT");
    expect(storedRoleFor("list", "ASSIGNED")).toBe("ASSIGNED");
    expect(storedRoleFor("list", "VIEW")).toBe("GUEST");
    expect(storedRoleFor("list", "EDIT")).toBe("MEMBER");
    // Not offered on a Folder: planGrant refuses it before anything is stored.
    const base = { actorMax: "FULL" as const, current: null, currentRow: null };
    expect(planGrant({ ...base, kind: "folder", requested: "COMMENT" }).error).toBe("invalid_role");
    expect(planGrant({ ...base, kind: "folder", requested: "ASSIGNED" }).error).toBe("invalid_role");
  });

  it("treats moving between Can view, Can comment and Can edit assigned tasks as a change", () => {
    const base = { kind: "list" as const, actorMax: "FULL" as const };
    const toComment = planGrant({ ...base, current: "VIEW", currentRow: "GUEST", requested: "COMMENT" });
    expect(toComment.error).toBeUndefined();
    expect(toComment.noChange).toBe(false);
    expect(toComment.writeRole).toBe("COMMENT");
    const toAssigned = planGrant({ ...base, current: "COMMENT", currentRow: "COMMENT", requested: "ASSIGNED" });
    expect(toAssigned.writeRole).toBe("ASSIGNED");
    expect(toAssigned.notify).toBe("upgraded");
    const same = planGrant({ ...base, current: "ASSIGNED", currentRow: "ASSIGNED", requested: "ASSIGNED" });
    expect(same.noChange).toBe(true);
  });
});

describe("the List ladder: how the resolver reads a row", () => {
  it("reads a GUEST row with a rung as that rung, and ignores a rung anywhere else", () => {
    expect(boardMemberToRole("GUEST", "COMMENT")).toBe("COMMENT");
    expect(boardMemberToRole("GUEST", "ASSIGNED")).toBe("ASSIGNED");
    expect(boardMemberToRole("GUEST", null)).toBe("VIEW");
    expect(boardMemberToRole("MEMBER", "COMMENT")).toBe("EDIT");
    expect(isListRung("COMMENT")).toBe(true);
    expect(isListRung("EDIT")).toBe(false);
  });

  it("gives the List its rung, and the legacy floor (which sees the GUEST row) never lifts it", () => {
    for (const at of [CUTOFF - 1, CUTOFF + 1]) {
      expect(listRole("GUEST", "COMMENT", at), `comment at ${at}`).toBe("COMMENT");
      expect(listRole("GUEST", "ASSIGNED", at), `assigned at ${at}`).toBe("ASSIGNED");
      expect(listRole("GUEST", null, at), `view at ${at}`).toBe("VIEW");
      expect(listRole("MEMBER", null, at), `edit at ${at}`).toBe("EDIT");
    }
  });
});

describe("the List ladder: what it gives on a task", () => {
  const signals = { orgAdmin: false, guest: false, creator: false, archived: false };

  it("maps every List role to its task half and its lift", () => {
    expect(taskSideOfListRole("ASSIGNED")).toEqual({ listRole: "COMMENT", assigneeLift: true });
    expect(taskSideOfListRole("COMMENT")).toEqual({ listRole: "COMMENT", assigneeLift: false });
    expect(taskSideOfListRole("VIEW")).toEqual({ listRole: "VIEW", assigneeLift: true });
    expect(taskSideOfListRole("EDIT")).toEqual({ listRole: "EDIT", assigneeLift: true });
    expect(taskSideOfListRole("OWNER")).toEqual({ listRole: "FULL", assigneeLift: true });
    expect(taskSideOfListRole("none")).toEqual({ listRole: "none", assigneeLift: true });
  });

  it("Can edit assigned tasks: changes a task assigned to them, comments on every other, never more", () => {
    const side = taskSideOfListRole("ASSIGNED");
    const mine = decideItem({ ...signals, assignee: true, ...side });
    expect(mine.role).toBe("EDIT");
    expect(allowsItemAction(mine, "edit", { creator: false })).toBe(true);
    const theirs = decideItem({ ...signals, assignee: false, ...side });
    expect(theirs.role).toBe("COMMENT");
    expect(allowsItemAction(theirs, "comment", { creator: false })).toBe(true);
    expect(allowsItemAction(theirs, "edit", { creator: false })).toBe(false);
  });

  it("Can comment: never changes a task, even one assigned to them", () => {
    const side = taskSideOfListRole("COMMENT");
    const mine = decideItem({ ...signals, assignee: true, ...side });
    expect(mine.role).toBe("COMMENT");
    expect(allowsItemAction(mine, "comment", { creator: false })).toBe(true);
    expect(allowsItemAction(mine, "edit", { creator: false })).toBe(false);
    expect(allowsItemAction(mine, "archive", { creator: false })).toBe(false);
  });

  it("Can view keeps today's rule: an assignee changes their task", () => {
    const side = taskSideOfListRole("VIEW");
    expect(decideItem({ ...signals, assignee: true, ...side }).role).toBe("EDIT");
    expect(decideItem({ ...signals, assignee: false, ...side }).role).toBe("VIEW");
  });

  it("a creator and an org admin keep Full access whatever the rung", () => {
    const side = taskSideOfListRole("COMMENT");
    expect(decideItem({ ...signals, creator: true, assignee: true, ...side }).role).toBe("FULL");
    expect(decideItem({ ...signals, orgAdmin: true, assignee: false, ...side }).role).toBe("FULL");
  });
});

describe("the List ladder: which rows a List view opens", () => {
  const row = (over: Partial<BoardItemRow>): BoardItemRow =>
    ({ id: "t", boardId: "l", title: "t", status: null, ownerId: null, assigneeIds: [], archivedAt: null, ...over }) as unknown as BoardItemRow;

  it("opens a row assigned to the viewer where the lift applies, and nothing else", () => {
    const lift = { userId: ME, lift: true };
    expect(assignedRowEditable(row({ assigneeIds: [ME] }), lift)).toBe(true);
    expect(assignedRowEditable(row({ ownerId: ME }), lift)).toBe(true);
    expect(assignedRowEditable(row({ assigneeIds: [OTHER] }), lift)).toBe(false);
    expect(assignedRowEditable(row({ assigneeIds: [ME] }), { userId: ME, lift: false })).toBe(false);
    expect(assignedRowEditable(row({ assigneeIds: [ME] }), null)).toBe(false);
    expect(assignedRowEditable(row({ assigneeIds: [ME], archivedAt: new Date() }), lift)).toBe(false);
    // A row shown through a link carries its own role: never opened here.
    expect(assignedRowEditable(row({ assigneeIds: [ME], listLink: { boardId: "x", position: 1, rootId: "t" } as BoardItemRow["listLink"] }), lift)).toBe(false);
  });
});
