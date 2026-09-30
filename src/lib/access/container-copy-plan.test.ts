import { describe, expect, it } from "vitest";
import { copyAssertions, diffContainerCopies, type MemberRow } from "./container-copy-plan";

const m = (objectType: MemberRow["objectType"], objectId: string, userId: string, role: MemberRow["role"]): MemberRow => ({ objectType, objectId, userId, role, createdAt: new Date(0) });

describe("container copy diff (access step 7)", () => {
  it("inserts the missing, re-roles the changed, deletes the orphaned, counts the equal", () => {
    const d = diffContainerCopies(
      [m("SPACE", "s", "u1", "OWNER"), m("LIST", "b", "u2", "MEMBER"), m("GOAL", "g", "u3", "GUEST")],
      [
        { id: "c1", objectType: "LIST", objectId: "b", subjectId: "u2", role: "ADMIN" },
        { id: "c2", objectType: "GOAL", objectId: "g", subjectId: "u3", role: "GUEST" },
        { id: "c3", objectType: "FOLDER", objectId: "f", subjectId: "gone", role: "MEMBER" },
      ],
    );
    expect(d.insert.map((r) => r.userId)).toEqual(["u1"]);
    expect(d.update).toEqual([{ id: "c1", role: "MEMBER", from: "ADMIN" }]);
    expect(d.remove.map((r) => r.id)).toEqual(["c3"]);
    expect(d.equal).toBe(1);
  });
  it("a removed member row never survives as a copy (the orphan is deleted, not kept)", () => {
    const d = diffContainerCopies([], [{ id: "c", objectType: "SPACE", objectId: "s", subjectId: "u", role: "ADMIN" }]);
    expect(d.remove).toHaveLength(1);
  });
  it("assertions compare per type", () => {
    expect(copyAssertions({ SPACE: 2, FOLDER: 0, LIST: 1, GOAL: 0 }, { SPACE: 2, FOLDER: 0, LIST: 1, GOAL: 0 })).toEqual([]);
    expect(copyAssertions({ SPACE: 2, FOLDER: 0, LIST: 1, GOAL: 0 }, { SPACE: 1, FOLDER: 0, LIST: 1, GOAL: 0 })).toHaveLength(1);
  });
});
