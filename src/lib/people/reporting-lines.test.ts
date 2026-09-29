import { describe, expect, it } from "vitest";
import { buildOrgForest, filterForest, pathTo, wouldCreateCycle } from "./reporting-lines";

const map = (pairs: Array<[string, string | null]>) => new Map(pairs);

describe("wouldCreateCycle", () => {
  const m = map([["ceo", null], ["vp", "ceo"], ["mgr", "vp"], ["ic", "mgr"]]);
  it("refuses a person as their own manager", () => expect(wouldCreateCycle("ic", "ic", m)).toBe(true));
  it("refuses a report as the manager of their chain", () => {
    expect(wouldCreateCycle("vp", "ic", m)).toBe(true);
    expect(wouldCreateCycle("ceo", "mgr", m)).toBe(true);
  });
  it("allows a sideways move and clearing the manager", () => {
    expect(wouldCreateCycle("ic", "vp", m)).toBe(false);
    expect(wouldCreateCycle("ic", null, m)).toBe(false);
  });
  it("does not loop forever on a loop elsewhere", () => {
    const bad = map([["a", "b"], ["b", "a"], ["x", null]]);
    expect(wouldCreateCycle("x", "a", bad)).toBe(false);
  });
});

describe("buildOrgForest", () => {
  const people = [
    { id: "ceo", managerId: null, name: "Zed" },
    { id: "vp", managerId: "ceo", name: "Vic" },
    { id: "ic1", managerId: "vp", name: "Ann" },
    { id: "ic2", managerId: "vp", name: "Bob" },
    { id: "solo", managerId: null, name: "Amy" },
    { id: "gone", managerId: "removed-person", name: "Gus" },
    { id: "l1", managerId: "l2", name: "Loop one" },
    { id: "l2", managerId: "l1", name: "Loop two" },
  ];
  it("returns every root, biggest team first, and never caps them", () => {
    const { roots } = buildOrgForest(people);
    expect(roots.map((r) => r.person.id)).toEqual(["ceo", "solo", "gone"]);
    expect(roots[0].total).toBe(3);
  });
  it("puts people in a loop in the unlinked group, never drops them", () => {
    const { roots, unlinked } = buildOrgForest(people);
    const placed = roots.reduce((n, r) => n + 1 + r.total, 0);
    expect(placed + unlinked.length).toBe(people.length);
    expect(unlinked.map((p) => p.id)).toEqual(["l1", "l2"]);
  });
  it("finds the path to a person and filters with ancestors kept", () => {
    const { roots } = buildOrgForest(people);
    expect(pathTo(roots, "ic2")).toEqual(["ceo", "vp", "ic2"]);
    const f = filterForest(roots, (p) => p.name === "Bob");
    expect(f).toHaveLength(1);
    expect(f[0].children[0].children.map((c) => c.person.id)).toEqual(["ic2"]);
  });
});
