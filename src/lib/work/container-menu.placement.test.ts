// The "New" menus read the one create rule (node-rules P1): for every role a
// viewer can hold on a Space or a Folder, the items newItemsFor offers are
// exactly the kinds createDecision accepts there. A menu that offered a row
// the server refuses (a List at Can edit refused for want of Full access, as
// it was) or hid one it accepts fails here.

import { describe, expect, it } from "vitest";
import { newItemsFor, type ContainerRole, type NewItem } from "./container-menu";
import { createDecision, emptyGrants, emptyRows, type MemberRole, type PlaceKind } from "../access/node-rules";

const ORG = "org-1";

function world(kind: "space" | "folder", member: MemberRole | null) {
  const rows = emptyRows(ORG, "strict");
  rows.spaces.set("S", { id: "S", organizationId: ORG, name: "S", slug: "s", icon: null, color: null, visibility: "WORKSPACE", ownerId: null });
  rows.folders.set("F", { id: "F", organizationId: ORG, spaceId: "S", parentFolderId: null, name: "F", icon: null, color: null, visibility: "WORKSPACE", ownerId: null, position: 0 });
  const grants = emptyGrants({ userId: "u", orgAdmin: false, orgGuest: false, isAgent: false, denied: false });
  if (member) grants[kind].set(kind === "space" ? "S" : "F", member);
  return { rows, grants, place: kind === "space" ? { kind: "space" as const, id: "S" } : { kind: "folder" as const, id: "F" } };
}

/** The Space and Folder rows each menu role comes from (a Space row's MEMBER is Can edit, ADMIN Full access). */
const ROLE_ROW: Record<ContainerRole, MemberRole | null> = { view: "GUEST", comment: "GUEST", edit: "MEMBER", full: "ADMIN" };

const ITEM_KIND: Record<NewItem, PlaceKind> = { list: "list", sprint: "list", folder: "folder", doc: "doc", canvas: "canvas", table: "table" };

describe("the New menus read the one create rule", () => {
  for (const kind of ["space", "folder"] as const) {
    for (const role of ["view", "edit", "full"] as const) {
      it(`${kind} at ${role}: every offered item is accepted, and every accepted kind is offered`, () => {
        const w = world(kind, ROLE_ROW[role]);
        const offered = new Set(newItemsFor(kind, role));
        for (const item of Object.keys(ITEM_KIND) as NewItem[]) {
          expect({ item, offered: offered.has(item) }).toEqual({ item, offered: createDecision(w.rows, w.grants, w.place, ITEM_KIND[item]) });
        }
      });
    }
  }

  it("Can comment and Can view get no New menu, a List and a path none either", () => {
    expect(newItemsFor("folder", "comment")).toEqual([]);
    expect(newItemsFor("space", "view")).toEqual([]);
    expect(newItemsFor("list", "full")).toEqual([]);
    expect(newItemsFor("folder", "full", true)).toEqual([]);
  });
});
