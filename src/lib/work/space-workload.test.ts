// The Space Workload tab's holder rules (src/lib/work/space-workload.ts): a
// departed person is never a row, a task nobody here holds is Unassigned
// with its departed holders kept for the Assign re-check, and that re-check
// never lets an Assign overwrite someone who took the task since.

import { describe, expect, it } from "vitest";
import { holdersOf, mayAssignOver, spaceWorkloadHolders } from "./space-workload";

const live = new Set(["ana", "ben", "cy"]);

describe("spaceWorkloadHolders", () => {
  it("keeps the live owner and assignees, once each, the owner out of the assignees", () => {
    expect(spaceWorkloadHolders({ ownerId: "ana", assigneeIds: ["ana", "ben", "ben"] }, live)).toEqual({
      ownerId: "ana",
      assigneeIds: ["ben"],
      assigneeCount: 2,
      unassigned: false,
      formerIds: [],
    });
  });

  it("drops a departed owner, and the task still counts for the live assignee on it", () => {
    expect(spaceWorkloadHolders({ ownerId: "gone", assigneeIds: ["cy"] }, live)).toEqual({
      ownerId: null,
      assigneeIds: ["cy"],
      assigneeCount: 1,
      unassigned: false,
      formerIds: [],
    });
  });

  it("makes a task only departed people hold Unassigned, naming them for the re-check", () => {
    expect(spaceWorkloadHolders({ ownerId: "gone", assigneeIds: ["left", "gone"] }, live)).toEqual({
      ownerId: null,
      assigneeIds: [],
      assigneeCount: 0,
      unassigned: true,
      formerIds: ["gone", "left"],
    });
  });

  it("answers a task with nobody on it as Unassigned with nobody to replace", () => {
    expect(spaceWorkloadHolders({ ownerId: null, assigneeIds: [] }, live)).toMatchObject({ unassigned: true, formerIds: [], assigneeCount: 0 });
  });
});

describe("mayAssignOver", () => {
  it("goes ahead on a task still held by nobody", () => {
    expect(mayAssignOver({ ownerId: null, assigneeIds: [] }, [])).toBe(true);
  });

  it("hands on a task that still names only the departed people it named at load", () => {
    expect(mayAssignOver({ ownerId: "gone", assigneeIds: ["left"] }, ["gone", "left"])).toBe(true);
    expect(mayAssignOver({ ownerId: null, assigneeIds: ["left"] }, ["gone", "left"])).toBe(true);
  });

  it("refuses when anyone took it since, even beside a departed holder", () => {
    expect(mayAssignOver({ ownerId: "ana", assigneeIds: [] }, [])).toBe(false);
    expect(mayAssignOver({ ownerId: "gone", assigneeIds: ["ben"] }, ["gone"])).toBe(false);
  });

  it("reads the owner and assignees once each", () => {
    expect(holdersOf({ ownerId: "a", assigneeIds: ["b", "a", "b"] })).toEqual(["a", "b"]);
  });
});
