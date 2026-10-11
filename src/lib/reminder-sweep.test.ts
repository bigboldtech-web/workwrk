import { describe, expect, it } from "vitest";
import { HAS_ASSIGNEE, isSweepTask, liveInWorkspace, sweepBoards, taskPeople } from "./reminder-sweep";
import { isSystemBoard } from "./system-items";

const gone = new Date("2026-09-01T00:00:00Z");

describe("sweepBoards", () => {
  it("keeps live Lists, with or without a Space or Folder", () => {
    const boards = [{ id: "personal" }, { id: "in-space", spaceId: "s" }, { id: "in-folder", spaceId: "s", folderId: "f" }];
    expect(sweepBoards(boards, [{ id: "s" }], [{ id: "f", spaceId: "s" }]).map((b) => b.id)).toEqual(["personal", "in-space", "in-folder"]);
  });

  it("drops an archived List, the hidden Meetings List, and any List under an archived Space or Folder at any depth", () => {
    const spaces = [{ id: "s-live" }, { id: "s-arch", archivedAt: gone }, { id: "s-kid", parentSpaceId: "s-arch" }, { id: "s-grandkid", parentSpaceId: "s-kid" }];
    const folders = [
      { id: "f-live", spaceId: "s-live" },
      { id: "f-arch", spaceId: "s-live", archivedAt: gone },
      { id: "f-kid", spaceId: "s-live", parentFolderId: "f-arch" },
      { id: "f-in-arch-space", spaceId: "s-arch" },
    ];
    const boards = [
      { id: "ok", spaceId: "s-live", folderId: "f-live" },
      { id: "archived", archivedAt: gone },
      { id: "meetings", settings: { system: true, hidden: true } },
      { id: "meeting-type", itemType: "meeting" },
      { id: "space-arch", spaceId: "s-arch" },
      { id: "space-grandkid", spaceId: "s-grandkid" },
      { id: "folder-arch", spaceId: "s-live", folderId: "f-arch" },
      { id: "folder-kid", spaceId: "s-live", folderId: "f-kid" },
      // A Folder in an archived Space, on a List whose own spaceId is stale.
      { id: "folder-in-arch-space", spaceId: null, folderId: "f-in-arch-space" },
    ];
    expect(sweepBoards(boards, spaces, folders).map((b) => b.id)).toEqual(["ok"]);
  });

  it("stops at a loop in the tree instead of hanging", () => {
    const spaces = [{ id: "a", parentSpaceId: "b" }, { id: "b", parentSpaceId: "a" }];
    expect(sweepBoards([{ id: "x", spaceId: "a" }], spaces, []).map((b) => b.id)).toEqual(["x"]);
  });
});

describe("isSystemBoard", () => {
  it("knows the hidden Meetings List by its settings or its item type, and nothing else", () => {
    expect(isSystemBoard({ settings: { system: true } })).toBe(true);
    expect(isSystemBoard({ itemType: "meeting" })).toBe(true);
    expect(isSystemBoard({ settings: { system: "yes" }, itemType: "studio-item" })).toBe(false);
    expect(isSystemBoard({ settings: null })).toBe(false);
    expect(isSystemBoard({ settings: [true] })).toBe(false);
  });
});

describe("who a task names", () => {
  it("names the first assignee and every other, each once", () => {
    expect(taskPeople({ ownerId: "a", assigneeIds: ["a", "b", "c", "b"] })).toEqual(["a", "b", "c"]);
    expect(taskPeople({ ownerId: null, assigneeIds: ["b"] })).toEqual(["b"]);
    expect(taskPeople({ ownerId: "a" })).toEqual(["a"]);
    expect(taskPeople({ ownerId: null, assigneeIds: [] })).toEqual([]);
  });

  it("reads a task with anyone assigned", () => {
    expect(HAS_ASSIGNEE).toEqual({ OR: [{ ownerId: { not: null } }, { NOT: { assigneeIds: { isEmpty: true } } }] });
  });

  it("counts a task, never a meeting's Item", () => {
    expect(isSweepTask({ itemType: "studio-item" })).toBe(true);
    expect(isSweepTask({ itemType: "meeting" })).toBe(false);
  });

  it("hears only a live person in this workspace", () => {
    const p = { id: "u", deletedAt: null, status: "ACTIVE", organizationId: "o", organizationMemberships: [] };
    expect(liveInWorkspace(p, "o")).toBe(true);
    expect(liveInWorkspace({ ...p, deletedAt: gone }, "o")).toBe(false);
    expect(liveInWorkspace({ ...p, status: "INACTIVE" }, "o")).toBe(false);
    expect(liveInWorkspace({ ...p, organizationId: "other" }, "o")).toBe(false);
    expect(liveInWorkspace({ ...p, organizationId: "other", organizationMemberships: [{ id: "m" }] }, "o")).toBe(true);
    expect(liveInWorkspace(null, "o")).toBe(false);
  });
});
