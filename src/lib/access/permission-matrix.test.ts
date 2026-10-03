// The "Who can do what" matrix (Settings, Access) held to the gates: each
// cell is what decideItem and allowsItemAction, or the List's rank rules,
// answer. If a rule changes, this fails and the page is reconsidered with it.

import { describe, expect, it } from "vitest";
import { listMatrix, taskCell, RELATIONSHIP_RULES, WORKSPACE_ROLES } from "./permission-matrix";

describe("listMatrix", () => {
  const m = listMatrix();
  const cellsOf = (key: string) => m.rows.find((r) => r.key === key)!.cells;

  it("has one column per List rung, widest first, named as the share dialog names them", () => {
    expect(m.columns.map((c) => c.label)).toEqual(["Full access", "Can edit", "Can edit assigned tasks", "Can comment", "Can view"]);
    for (const c of m.columns) expect(c.blurb.length).toBeGreaterThan(5);
  });

  it("states each task right as the task gate decides it", () => {
    //                       Full   Edit   Assigned          Comment View
    expect(cellsOf("read")).toEqual(["yes", "yes", "yes", "yes", "yes"]);
    expect(cellsOf("comment")).toEqual(["yes", "yes", "yes", "yes", "assignedOrOwn"]);
    expect(cellsOf("edit")).toEqual(["yes", "yes", "assignedOrOwn", "no", "assignedOrOwn"]);
    expect(cellsOf("archive")).toEqual(["yes", "yes", "assignedOrOwn", "no", "assignedOrOwn"]);
    // A creator holds Full access (rule 5) at every rung but Can comment.
    expect(cellsOf("delete")).toEqual(["yes", "own", "own", "no", "own"]);
  });

  it("states each List right as the List routes decide it", () => {
    expect(cellsOf("add")).toEqual(["yes", "yes", "no", "no", "no"]);
    expect(cellsOf("arrange")).toEqual(["yes", "yes", "no", "no", "no"]);
    expect(cellsOf("manage")).toEqual(["yes", "no", "no", "no", "no"]);
    expect(cellsOf("share")).toEqual(["yes", "no", "no", "no", "no"]);
  });

  it("never claims a cut that the gate does not make: Can comment changes nothing, not even their own", () => {
    for (const action of ["edit", "archive", "delete", "move", "duplicate"] as const) expect(taskCell("COMMENT", action), action).toBe("no");
  });

  it("names every relationship rule and workspace role in plain words", () => {
    expect(RELATIONSHIP_RULES.map((r) => r.key)).toEqual(["assignee", "creator", "union", "assigning", "admin", "owner", "linked", "inherit", "trash", "agent"]);
    expect(WORKSPACE_ROLES.map((r) => r.role)).toEqual(["Owner", "Admin", "Member", "Agent"]);
    for (const r of [...RELATIONSHIP_RULES.flatMap((x) => [x.who, x.gets]), ...WORKSPACE_ROLES.map((x) => x.summary)]) {
      expect(r).not.toMatch(/—|--/);
      // A customer's security reviewer reads this page: no rule numbers or project phases.
      expect(r, r).not.toMatch(/\brule \d|\bR\d|\bPhase\b|node-rules|item-role/i);
    }
  });
});
