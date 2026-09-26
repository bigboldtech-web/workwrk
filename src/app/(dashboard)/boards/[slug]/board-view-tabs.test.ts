import { describe, expect, it } from "vitest";
import { defaultTabTitle, viewTabGates, type BoardViewItem } from "./board-view-tabs";
import { viewMenuHasRows } from "@/components/board-view/view-tab-menu";

const view = (ownerId: string | null): BoardViewItem => ({
  id: "v1", name: "Calendar", type: "CALENDAR", isDefault: false, config: null, isShared: true, ownerId,
});

describe("defaultTabTitle", () => {
  it("tells a person who can pin another tab how to move the default", () => {
    expect(defaultTabTitle({ isDefault: true, manyTabs: true, defaultPinned: false, canPinAny: true }))
      .toBe("Default view. Pin another view to put it first.");
  });
  it("never points a view-only reader at a pin they cannot make", () => {
    expect(defaultTabTitle({ isDefault: true, manyTabs: true, defaultPinned: false, canPinAny: false }))
      .toBe("Default view");
  });
  it("keeps the pinned wording for a pinned default, whoever looks", () => {
    expect(defaultTabTitle({ isDefault: true, manyTabs: true, defaultPinned: true, canPinAny: false }))
      .toBe("Pinned as the default view");
  });
  it("has no tooltip on other tabs or on a lone tab", () => {
    expect(defaultTabTitle({ isDefault: false, manyTabs: true, defaultPinned: false, canPinAny: true })).toBeUndefined();
    expect(defaultTabTitle({ isDefault: true, manyTabs: false, defaultPinned: false, canPinAny: true })).toBeUndefined();
  });
});

describe("viewTabGates", () => {
  it("gives a view-only reader nothing on someone else's view", () => {
    const g = viewTabGates({ view: view("someone"), currentUserId: "me", canContribute: false, canDeleteShared: false });
    expect(g).toEqual({ canRename: false, canDuplicate: false, canDelete: false });
    expect(viewMenuHasRows("none", g)).toBe(false);
  });
  it("keeps Rename and Delete on a reader's own view (the routes allow the owner)", () => {
    const g = viewTabGates({ view: view("me"), currentUserId: "me", canContribute: false, canDeleteShared: false });
    expect(g).toEqual({ canRename: true, canDuplicate: false, canDelete: true });
  });
  it("gives a contributor Rename and Duplicate, and Delete only with management", () => {
    expect(viewTabGates({ view: view("someone"), currentUserId: "me", canContribute: true, canDeleteShared: false }))
      .toEqual({ canRename: true, canDuplicate: true, canDelete: false });
    expect(viewTabGates({ view: view(null), currentUserId: "me", canContribute: true, canDeleteShared: true }))
      .toEqual({ canRename: true, canDuplicate: true, canDelete: true });
  });
  it("a signed-out viewer never matches an ownerless view", () => {
    const g = viewTabGates({ view: view(null), currentUserId: null, canContribute: false, canDeleteShared: false });
    expect(g.canRename || g.canDelete).toBe(false);
  });
});

describe("viewMenuHasRows", () => {
  it("keeps the full menu for a caller that passes no gates", () => {
    expect(viewMenuHasRows("none")).toBe(true);
  });
  it("opens for a pin row alone", () => {
    expect(viewMenuHasRows("unpin", { canRename: false, canDuplicate: false, canDelete: false })).toBe(true);
  });
});
