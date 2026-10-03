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

import { describe, expect, it, vi } from "vitest";

// node-world loads rows from the database; only its pure copy is used here.
vi.mock("../prisma", () => ({ prisma: {} }));

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
import { accessEntries } from "./node-tree";
import { grantsWithViewer } from "./node-world";
import { allowsItemAction, decideItem, taskSideOfListRole } from "../item-role";
import { assignedRowEditable, rowFieldsEditable, watchOnlyPatch } from "../list-link-rows";
import { roleCoversRequest } from "./access-requests";
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
    expect(panelRoleBlurb("list", "COMMENT")).toMatch(/change none, not even their own, unless they can open the List another way/);
    expect(panelRoleBlurb("list", "VIEW")).toMatch(/except tasks assigned to them or that they made/);
    expect(panelRoleBlurb("list", "ASSIGNED")).toMatch(/change only tasks assigned to them or that they made/);
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

describe("the List ladder: a rung survives every copy of a person's rows", () => {
  // The share panel and the reader fan-outs load everyone's rows at once
  // (loadAllGrants) and copy each person's into a ViewerGrants. A copy that
  // left the rung behind showed a Can edit assigned tasks member as Can view.
  const loaded = (): Omit<ViewerGrants, "viewer"> => ({
    space: new Map(),
    folder: new Map(),
    list: new Map([["l", "GUEST"]]),
    listRung: new Map([["l", "ASSIGNED"]]),
    object: new Map(),
    since: new Map([["list:l", CUTOFF + 1]]),
  });

  it("keeps the rung in the person's grants", () => {
    const { rows } = world();
    const g = grantsWithViewer(viewer(), loaded());
    expect(g.viewer.userId).toBe(ME);
    expect(new NodeEvaluator(rows, g).effective({ kind: "list", id: "l" }).role).toBe("ASSIGNED");
    expect(grantsWithViewer(viewer(), undefined).list.size).toBe(0);
  });

  it("names the rung on the share panel, as a row the List's owner may change", () => {
    const { rows } = world();
    const eve = { person: { id: ME, name: "Eve", email: "eve@acme.test", avatar: null, active: true }, grants: grantsWithViewer(viewer(), loaded()) };
    // The List's owner, a member of its Space (the owner rule reaches through the Space).
    const owner = {
      person: { id: OTHER, name: "Mona", email: "mona@acme.test", avatar: null, active: true },
      grants: emptyGrants({ userId: OTHER, orgAdmin: false, orgGuest: false, isAgent: false, denied: false }),
    };
    owner.grants.space.set("s", "MEMBER");
    const out = accessEntries({ rows, ref: { kind: "list", id: "l" }, people: [eve, owner], viewer: owner.grants, orgName: "Acme", hrefOf: () => null });
    expect(out.direct.find((d) => d.person.id === ME)).toMatchObject({ role: "ASSIGNED", source: "BoardMember", editable: true, removable: true });
  });
});

describe("the List ladder: what it gives on a task", () => {
  const signals = { orgAdmin: false, guest: false, creator: false, archived: false };

  it("maps every List role to its task half and its two lifts", () => {
    expect(taskSideOfListRole("ASSIGNED")).toEqual({ listRole: "COMMENT", assigneeLift: true, creatorLift: true });
    expect(taskSideOfListRole("COMMENT")).toEqual({ listRole: "COMMENT", assigneeLift: false, creatorLift: false });
    expect(taskSideOfListRole("VIEW")).toEqual({ listRole: "VIEW", assigneeLift: true, creatorLift: true });
    expect(taskSideOfListRole("EDIT")).toEqual({ listRole: "EDIT", assigneeLift: true, creatorLift: true });
    expect(taskSideOfListRole("OWNER")).toEqual({ listRole: "FULL", assigneeLift: true, creatorLift: true });
    expect(taskSideOfListRole("none")).toEqual({ listRole: "none", assigneeLift: true, creatorLift: true });
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

  it("Can comment: a task they made stays read and discuss too, and never deletes", () => {
    const side = taskSideOfListRole("COMMENT");
    const made = decideItem({ ...signals, creator: true, assignee: true, ...side });
    expect(made.role).toBe("COMMENT");
    expect(allowsItemAction(made, "edit", { creator: true })).toBe(false);
    expect(allowsItemAction(made, "delete", { creator: true })).toBe(false);
  });

  it("a creator keeps Full access at Can edit assigned tasks and Can view, and an org admin at every rung", () => {
    for (const rung of ["ASSIGNED", "VIEW"] as const) {
      expect(decideItem({ ...signals, creator: true, assignee: false, ...taskSideOfListRole(rung) }).role, rung).toBe("FULL");
    }
    for (const rung of ["COMMENT", "ASSIGNED", "VIEW"] as const) {
      expect(decideItem({ ...signals, orgAdmin: true, assignee: false, ...taskSideOfListRole(rung) }).role, rung).toBe("FULL");
    }
  });
});

describe("the List ladder: a share only adds (Can comment with Can view from elsewhere)", () => {
  // The person's own List row is Can comment; what else reaches the List?
  function withOther(other: (rows: NodeRows, g: ViewerGrants) => void): { role: NodeRole; via: string } {
    const { rows, g } = world();
    g.list.set("l", "GUEST");
    (g.listRung ??= new Map()).set("l", "COMMENT");
    g.since!.set("list:l", CUTOFF + 1);
    other(rows, g);
    const res = new NodeEvaluator(rows, g).effective({ kind: "list", id: "l" });
    return { role: res.role, via: res.via.type };
  }

  it("held alone, Can comment stays Can comment: nothing changes, not even their own tasks", () => {
    expect(withOther(() => {}).role).toBe("COMMENT");
  });

  it("with Can view through the Space, it is Can edit assigned tasks, named from the Space", () => {
    const r = withOther((_rows, g) => {
      g.space.set("s", "GUEST");
      g.since!.set("space:s", CUTOFF + 1);
    });
    expect(r).toEqual({ role: "ASSIGNED", via: "inherited" });
  });

  it("with the Space open to the whole company, it is Can edit assigned tasks, named from everyone", () => {
    const r = withOther((rows) => {
      rows.spaces.set("s", { ...rows.spaces.get("s")!, visibility: "ORG" });
    });
    expect(r).toEqual({ role: "ASSIGNED", via: "everyone" });
  });

  it("a higher source still wins outright: Space Member gives Can edit", () => {
    const r = withOther((_rows, g) => {
      g.space.set("s", "MEMBER");
      g.since!.set("space:s", CUTOFF + 1);
    });
    expect(r.role).toBe("EDIT");
  });

  it("a Private List takes nothing from above, so Can comment alone stays Can comment", () => {
    const r = withOther((rows, g) => {
      rows.lists.set("l", { ...rows.lists.get("l")!, visibility: "PRIVATE" });
      g.space.set("s", "GUEST");
      g.since!.set("space:s", CUTOFF + 1);
    });
    expect(r.role).toBe("COMMENT");
  });

  it("under the strict Private rule the union holds too", () => {
    const r = withOther((rows, g) => {
      rows.privateRule = "strict";
      g.space.set("s", "GUEST");
    });
    expect(r.role).toBe("ASSIGNED");
  });

  it("the share panel shows the row as Can comment and the rest as also Can edit assigned tasks from the Space", () => {
    const { rows } = world();
    const g = grantsWithViewer(viewer(), {
      space: new Map([["s", "GUEST"]]),
      folder: new Map(),
      list: new Map([["l", "GUEST"]]),
      listRung: new Map([["l", "COMMENT"]]),
      object: new Map(),
      since: new Map([["list:l", CUTOFF + 1], ["space:s", CUTOFF + 1]]),
    });
    const eve = { person: { id: ME, name: "Eve", email: "eve@acme.test", avatar: null, active: true }, grants: g };
    const owner = {
      person: { id: OTHER, name: "Mona", email: "mona@acme.test", avatar: null, active: true },
      grants: emptyGrants({ userId: OTHER, orgAdmin: false, orgGuest: false, isAgent: false, denied: false }),
    };
    owner.grants.space.set("s", "MEMBER");
    const out = accessEntries({ rows, ref: { kind: "list", id: "l" }, people: [eve, owner], viewer: owner.grants, orgName: "Acme", hrefOf: () => null });
    const row = out.direct.find((d) => d.person.id === ME)!;
    expect(row.role).toBe("COMMENT");
    expect(row.alsoVia?.role).toBe("ASSIGNED");
  });
});

describe("the List ladder: what hangs off a List never reads a task-only rung", () => {
  it("a doc on the List reads Can edit assigned tasks as Can comment (a row of this release)", () => {
    const { rows, g } = world();
    rows.docs.set("d", { id: "d", organizationId: ORG, title: "d", entityType: "BOARD", entityId: "l", parentId: null, createdById: OTHER });
    g.list.set("l", "GUEST");
    (g.listRung ??= new Map()).set("l", "ASSIGNED");
    // Written after the cutoff, so the doc follows the List's role (A5)
    // rather than the older rule's "every reach edits an unrestricted doc" (A8).
    g.since!.set("list:l", CUTOFF + 1);
    expect(new NodeEvaluator(rows, g).effective({ kind: "doc", id: "d" }).role).toBe("COMMENT");
  });

  it("a form that sends answers to the List opens read-only at either rung, as at Can view", () => {
    for (const rung of ["COMMENT", "ASSIGNED"] as const) {
      const { rows, g } = world();
      rows.privateRule = "strict";
      rows.forms.set("f", { id: "f", organizationId: ORG, createdById: OTHER, name: "f", targetBoardId: "l", targetTableId: null });
      g.list.set("l", "GUEST");
      (g.listRung ??= new Map()).set("l", rung);
      expect(new NodeEvaluator(rows, g).effective({ kind: "form", id: "f" }).role, rung).toBe("VIEW");
    }
  });
});

describe("the List ladder: an access request is answered by the rung that covers it", () => {
  it("Can edit assigned tasks answers a request for Can view or Can comment, never one for Can edit", () => {
    expect(roleCoversRequest("ASSIGNED", "VIEW")).toBe(true);
    expect(roleCoversRequest("ASSIGNED", "COMMENT")).toBe(true);
    expect(roleCoversRequest("ASSIGNED", "EDIT")).toBe(false);
  });

  it("keeps the request ladder in the panel's order", () => {
    const roles = Object.keys(PANEL_ROLE_RANK).filter((r) => r !== "none");
    for (const held of roles) {
      for (const asked of ["VIEW", "COMMENT", "EDIT"] as const) {
        const rank = PANEL_ROLE_RANK as Record<string, number>;
        expect(roleCoversRequest(held, asked), `${held} for ${asked}`).toBe(rank[held] >= rank[asked]);
      }
    }
  });
});

describe("the List ladder: which rows a List view opens", () => {
  const row = (over: Partial<BoardItemRow>): BoardItemRow =>
    ({ id: "t", boardId: "l", title: "t", status: null, ownerId: null, assigneeIds: [], archivedAt: null, ...over }) as unknown as BoardItemRow;

  it("opens a row assigned to the viewer where the lift applies, and nothing else", () => {
    const lift = { userId: ME, lift: true };
    expect(assignedRowEditable(row({ assigneeIds: [ME] }), lift)).toBe(true);
    expect(assignedRowEditable(row({ ownerId: ME }), lift)).toBe(true);
    // A task they made stays theirs (rule 5), and is shut where the lift is.
    const mine = { id: ME, firstName: "Eve", lastName: "", avatar: null };
    expect(assignedRowEditable(row({ createdBy: mine }), lift)).toBe(true);
    expect(assignedRowEditable(row({ createdBy: mine }), { userId: ME, lift: false })).toBe(false);
    expect(assignedRowEditable(row({ assigneeIds: [OTHER] }), lift)).toBe(false);
    expect(assignedRowEditable(row({ assigneeIds: [ME] }), { userId: ME, lift: false })).toBe(false);
    expect(assignedRowEditable(row({ assigneeIds: [ME] }), null)).toBe(false);
    expect(assignedRowEditable(row({ assigneeIds: [ME], archivedAt: new Date() }), lift)).toBe(false);
    // A row shown through a link carries its own role: never opened here.
    expect(assignedRowEditable(row({ assigneeIds: [ME], listLink: { boardId: "x", position: 1, rootId: "t" } as BoardItemRow["listLink"] }), lift)).toBe(false);
  });

  it("lets a view save exactly what it draws as editable", () => {
    const lift = { userId: ME, lift: true };
    // Can edit on the List: every home row.
    expect(rowFieldsEditable(row({ assigneeIds: [OTHER] }), true, null)).toBe(true);
    // Below it: only the rows assigned to them, where the lift applies.
    expect(rowFieldsEditable(row({ assigneeIds: [ME] }), false, lift)).toBe(true);
    expect(rowFieldsEditable(row({ assigneeIds: [OTHER] }), false, lift)).toBe(false);
    expect(rowFieldsEditable(row({ assigneeIds: [ME] }), false, { userId: ME, lift: false })).toBe(false);
  });

  it("lets any reader watch: a change that only touches watchers", () => {
    expect(watchOnlyPatch({ watcherIds: [ME] })).toBe(true);
    expect(watchOnlyPatch({ watcherIds: [ME], status: "DONE" })).toBe(false);
    expect(watchOnlyPatch({ status: "DONE" })).toBe(false);
    expect(watchOnlyPatch({})).toBe(false);
  });
});
