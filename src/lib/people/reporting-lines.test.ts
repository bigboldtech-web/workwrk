import { describe, expect, it } from "vitest";
import { buildOrgForest, filterForest, pathTo, planReportHandover, reportHandoverNote, wouldCreateCycle } from "./reporting-lines";

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

// Docs-found fixes batch 2: an Agent is never anyone's manager (access 2.4),
// so a handover to an Agent sends the work as asked but the reports up to the
// leaver's own manager, and the transfer dialog says so before it runs.
describe("planReportHandover", () => {
  // boss > leaver > r1, r2; boss > peer
  const m = new Map<string, string | null>([["boss", null], ["leaver", "boss"], ["r1", "leaver"], ["r2", "leaver"], ["peer", "boss"]]);

  it("gives the reports to a recipient who may manage them", () => {
    const p = planReportHandover({ leaverId: "leaver", recipientId: "peer", recipientIsAgent: false, managers: m, agentIds: new Set() });
    expect(p.toRecipient).toEqual(["r1", "r2"]);
    expect([...p.rehome.keys()]).toEqual([]);
  });

  it("never gives them to an Agent: they go up to the leaver's own manager", () => {
    const p = planReportHandover({ leaverId: "leaver", recipientId: "peer", recipientIsAgent: true, managers: m, agentIds: new Set(["peer"]) });
    expect(p.toRecipient).toEqual([]);
    expect(p.rehome.get("boss")).toEqual(["r1", "r2"]);
  });

  it("never sends them up to an Agent either, nor into a loop", () => {
    const agentBoss = planReportHandover({ leaverId: "leaver", recipientId: "peer", recipientIsAgent: true, managers: m, agentIds: new Set(["peer", "boss"]) });
    expect(agentBoss.rehome.get(null)).toEqual(["r1", "r2"]);
    // r1 as the recipient: r1 cannot manage itself, r2 may go to r1.
    const loop = planReportHandover({ leaverId: "leaver", recipientId: "r1", recipientIsAgent: false, managers: m, agentIds: new Set() });
    expect(loop.toRecipient).toEqual(["r2"]);
    expect(loop.rehome.get("boss")).toEqual(["r1"]);
  });
});

describe("reportHandoverNote", () => {
  it("says where the reports go when the person picked is an Agent", () => {
    expect(reportHandoverNote({ recipientIsAgent: true, rehomed: [{ to: "Dana Lee", count: 3 }] }, "Sam Agent")).toBe(
      "Sam Agent is on the Agent tier, and an Agent can't be anyone's manager. Their 3 direct reports go to Dana Lee instead. The rest still goes to Sam Agent.",
    );
    expect(reportHandoverNote({ recipientIsAgent: true, rehomed: [{ to: null, count: 1 }] }, "Sam Agent")).toContain("Their direct report goes to no manager for now instead.");
  });

  it("names a loop, and says nothing when every report goes to the person picked", () => {
    expect(reportHandoverNote({ recipientIsAgent: false, rehomed: [{ to: "Dana Lee", count: 1 }] }, "Rae")).toBe("Their direct report goes to Dana Lee, because moving it to Rae would make a reporting loop.");
    expect(reportHandoverNote({ recipientIsAgent: false, rehomed: [] }, "Rae")).toBeNull();
    const words = reportHandoverNote({ recipientIsAgent: true, rehomed: [{ to: "Dana Lee", count: 2 }, { to: null, count: 1 }] }, "Sam");
    expect(words).toContain("Of their direct reports, 2 go to Dana Lee and 1 goes to no manager for now instead.");
    expect(words).not.toMatch(/\u2014|-{2}/);
  });
});
