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

describe("container copy diff never deletes the G5 reach-preservation rows (stage E fix)", () => {
  const g5 = { id: "g5", objectType: "LIST" as const, objectId: "private-list", subjectId: "space-owner", role: "ADMIN" as const, source: "backfill.g5", objectRole: "FULL" };
  it("a tagged G5 row with no member twin is kept, not removed", () => {
    const d = diffContainerCopies([], [g5]);
    expect(d.remove).toEqual([]);
    expect(d.protectedKept).toBe(1);
  });
  it("an untagged G5-shaped row (written before the source column) is kept", () => {
    const d = diffContainerCopies([], [{ ...g5, source: null }]);
    expect(d.remove).toEqual([]);
  });
  it("an untagged plain copy is still diffed (adopted as a copy)", () => {
    const d = diffContainerCopies([], [{ id: "c", objectType: "SPACE", objectId: "s", subjectId: "u", role: "ADMIN", source: null, objectRole: null }]);
    expect(d.remove.map((r) => r.id)).toEqual(["c"]);
  });
  it("a member row whose key a G5 row holds is not inserted over it, and the assertion allows for it", () => {
    const d = diffContainerCopies([m("LIST", "private-list", "space-owner", "MEMBER")], [g5]);
    expect(d.insert).toEqual([]);
    expect(d.heldByProtected).toBe(1);
    expect(copyAssertions({ SPACE: 0, FOLDER: 0, LIST: 1, GOAL: 0 }, { SPACE: 0, FOLDER: 0, LIST: 0, GOAL: 0 }, { LIST: 1 }, 1, 1)).toEqual([]);
  });
  it("the assertion fails when a protected row vanished", () => {
    expect(copyAssertions({ SPACE: 0, FOLDER: 0, LIST: 0, GOAL: 0 }, { SPACE: 0, FOLDER: 0, LIST: 0, GOAL: 0 }, {}, 1, 0)).toHaveLength(1);
  });
  it("a row from another writer (unknown source) is never touched", () => {
    const d = diffContainerCopies([], [{ id: "x", objectType: "FOLDER", objectId: "f", subjectId: "u", role: "MEMBER", source: "share.dialog", objectRole: null }]);
    expect(d.remove).toEqual([]);
  });
});
