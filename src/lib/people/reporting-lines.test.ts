import { describe, expect, it } from "vitest";
import { agentReportsNote, buildOrgForest, effectiveManagerFrom, filterForest, linesAlsoElsewhereNote, linesStayNote, liveManagerFrom, pathTo, planReportHandover, reportHandoverNote, wouldCreateCycle, type LineFacts } from "./reporting-lines";

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

// Docs-found fixes batch 3: the walks up a line that read an Agent as no
// one's manager, and that send moving reports only to someone live.
const lines = (rows: Array<[string, string | null, Partial<LineFacts>?]>) =>
  new Map(rows.map(([id, managerId, f]) => [id, { managerId, agent: false, inactive: false, ...f }]));

describe("effectiveManagerFrom", () => {
  const people = lines([
    ["vp", null], ["mona", "vp"], ["sam", "mona", { agent: true }], ["ace", "sam", { agent: true }],
    ["rex", "gone", { agent: true }], ["dan", "vp", { inactive: true }],
  ]);
  it("passes over any number of Agents to the next manager up", () => {
    expect(effectiveManagerFrom("sam", people)).toBe("mona");
    expect(effectiveManagerFrom("ace", people)).toBe("mona");
  });
  it("keeps a stored manager who is no Agent as stored, deactivated or not", () => {
    expect(effectiveManagerFrom("mona", people)).toBe("mona");
    expect(effectiveManagerFrom("dan", people)).toBe("dan");
    expect(effectiveManagerFrom("gone", people)).toBe("gone");
  });
  it("answers nobody when the line past an Agent ends, loops or reaches a removed person", () => {
    expect(effectiveManagerFrom("rex", people)).toBeNull();
    expect(effectiveManagerFrom("a1", lines([["a1", "a2", { agent: true }], ["a2", "a1", { agent: true }]]))).toBeNull();
    expect(effectiveManagerFrom("top", lines([["top", null, { agent: true }]]))).toBeNull();
    expect(effectiveManagerFrom(null, people)).toBeNull();
  });
});

describe("liveManagerFrom", () => {
  it("passes over Agents and deactivated people, and gives up at a removed one", () => {
    const people = lines([["big", null], ["boss", "big", { inactive: true }], ["sam", "boss", { agent: true }], ["lost", "gone"]]);
    expect(liveManagerFrom("big", people)).toBe("big");
    expect(liveManagerFrom("boss", people)).toBe("big");
    expect(liveManagerFrom("sam", people)).toBe("big");
    expect(liveManagerFrom("gone", people)).toBeNull();
    expect(liveManagerFrom("lost", people)).toBe("lost");
  });
});

describe("planReportHandover with the line's facts (batch 3)", () => {
  // big > boss > leaver > r1, r2
  const managers = map([["big", null], ["boss", "big"], ["leaver", "boss"], ["r1", "leaver"], ["r2", "leaver"], ["sam", "big"]]);
  it("sends the reports past a deactivated manager to the first one who can manage them", () => {
    const people = lines([["big", null], ["boss", "big", { inactive: true }], ["leaver", "boss"], ["r1", "leaver"], ["r2", "leaver"], ["sam", "big", { agent: true }]]);
    const plan = planReportHandover({ leaverId: "leaver", recipientId: "sam", recipientIsAgent: true, managers, agentIds: new Set(["sam"]), people });
    expect([...plan.rehome]).toEqual([["big", ["r1", "r2"]]]);
  });
  it("and to no manager when the line reaches a removed person", () => {
    const people = lines([["leaver", "boss"], ["r1", "leaver"], ["r2", "leaver"], ["sam", null, { agent: true }]]);
    const plan = planReportHandover({ leaverId: "leaver", recipientId: "sam", recipientIsAgent: true, managers, agentIds: new Set(["sam"]), people });
    expect([...plan.rehome]).toEqual([[null, ["r1", "r2"]]]);
  });
});

describe("agentReportsNote", () => {
  it("says the Agent manages nobody listed under them, and what Move their reports does", () => {
    expect(agentReportsNote({ solid: 3, dotted: 1, rehomed: [{ to: "Dana Lee", count: 3 }] }, "Sam Agent")).toBe(
      "Sam Agent is on the Agent tier, and an Agent can't be anyone's manager, so Sam Agent doesn't manage the 3 direct reports and 1 dotted-line report still listed under them. Move them so the record matches: the 3 direct reports go to Dana Lee, and the dotted line is taken off.",
    );
    expect(agentReportsNote({ solid: 1, dotted: 0, rehomed: [{ to: null, count: 1 }] }, "Sam")).toBe(
      "Sam is on the Agent tier, and an Agent can't be anyone's manager, so Sam doesn't manage the 1 direct report still listed under them. Move them so the record matches: the direct report goes to no manager for now.",
    );
    expect(agentReportsNote({ solid: 0, dotted: 2, rehomed: [] }, "Sam")).toMatch(/2 dotted-line reports still listed under them\. Move them so the record matches: the dotted lines are taken off\.$/);
    expect(agentReportsNote({ solid: 0, dotted: 0, rehomed: [] }, "Sam")).toBeNull();
  });
  it("holds no dashes", () => {
    const text = agentReportsNote({ solid: 2, dotted: 2, rehomed: [{ to: "A", count: 1 }, { to: null, count: 1 }] }, "Sam") ?? "";
    expect(text).not.toMatch(/\u2014|\u2013|--/);
  });
});

// Docs-found fixes batch 4.
describe("effectiveManagerFrom never names the person themselves", () => {
  it("a loop back through an Agent, and a stored self-line, name nobody", () => {
    // pia > axe (Agent) > pia: past axe the walk lands on pia.
    const people = lines([["pia", "axe"], ["axe", "pia", { agent: true }], ["sol", "sol"]]);
    expect(effectiveManagerFrom("axe", people, "pia")).toBeNull();
    expect(effectiveManagerFrom("sol", people, "sol")).toBeNull();
    // Someone else under axe still reads pia as their manager.
    expect(effectiveManagerFrom("axe", people, "kid")).toBe("pia");
  });
});

describe("planReportHandover to a deactivated recipient", () => {
  it("sends the work as asked but never the reports, which go up the leaver's line", () => {
    const managers = map([["boss", null], ["leaver", "boss"], ["r1", "leaver"], ["rae", "boss"]]);
    const people = lines([["boss", null], ["leaver", "boss"], ["r1", "leaver"], ["rae", "boss", { inactive: true }]]);
    const plan = planReportHandover({ leaverId: "leaver", recipientId: "rae", recipientIsAgent: false, recipientInactive: true, managers, agentIds: new Set(), people });
    expect(plan.toRecipient).toEqual([]);
    expect([...plan.rehome]).toEqual([["boss", ["r1"]]]);
  });
});

// Docs-found fixes batch 6: a report whose line another workspace relies on
// stays where it is, and the dialogs say who and why.
describe("planReportHandover leaves the reports another workspace relies on", () => {
  it("answers them apart, and in none of the moves", () => {
    const managers = new Map<string, string | null>([["boss", null], ["leo", "boss"], ["ida", "leo"], ["kim", "leo"]]);
    const plan = planReportHandover({ leaverId: "leo", recipientId: "rae", recipientIsAgent: false, managers, agentIds: new Set(), stays: new Set(["ida"]) });
    expect(plan.stays).toEqual(["ida"]);
    expect(plan.reportIds).toEqual(["kim"]);
    expect(plan.toRecipient).toEqual(["kim"]);
    const up = planReportHandover({ leaverId: "leo", recipientId: "sam", recipientIsAgent: true, managers, agentIds: new Set(), stays: new Set(["ida"]) });
    expect([...up.rehome.values()].flat()).toEqual(["kim"]);
  });
});

describe("linesStayNote", () => {
  it("names who stays and why, never the other workspace, in plain words", () => {
    expect(linesStayNote([], "Leo Leaver")).toBeNull();
    const one = linesStayNote([{ name: "Ida Ray" }], "Leo Leaver");
    expect(one).toBe("Ida Ray stays listed under Leo Leaver. They also work with Leo Leaver in another workspace, where that line still counts, so it's left as it is.");
    expect(linesStayNote([{ name: "Ida Ray" }, { name: "Kim Lo", kind: "dotted" }], "Gil Agent")).toBe(
      "Ida Ray stays listed under Gil Agent, and Kim Lo keeps a dotted line to Gil Agent. They also work with Gil Agent in another workspace, where those lines still count, so they're left as they are.",
    );
    expect(linesStayNote([{ name: "A" }, { name: "B" }, { name: "C" }, { name: null }], "Leo")).toMatch(/^A, B and 2 others stay listed under Leo\./);
    for (const s of [one]) expect(s).not.toMatch(/--|\u2014/);
  });
});

// Docs-found fixes batch 7: a handover's leaver is deactivated or removed
// next, in every workspace, so every report moves. Batch 6's words, "stays
// listed under them ... left as it is", were untrue once that landed.
describe("linesAlsoElsewhereNote", () => {
  it("says before and after that the line moves too and the other workspace's Audit log records it, never naming that workspace", () => {
    expect(linesAlsoElsewhereNote([{ name: "Ida Ray" }], "Leo Leaver", false)).toBe(
      "Ida Ray also reports to Leo Leaver in another workspace. Leo Leaver's account ends there too, so that line moves with the rest, and that workspace's Audit log records it.",
    );
    expect(linesAlsoElsewhereNote([{ name: "Ida Ray" }, { name: null }], "Leo Leaver", true)).toBe(
      "Ida Ray and Someone also reported to Leo Leaver in another workspace. Those lines moved too, and that workspace's Audit log records it.",
    );
    for (const done of [false, true]) {
      const said = linesAlsoElsewhereNote([{ name: "Ida Ray" }, { name: "Kim Lo" }], "Leo Leaver", done) ?? "";
      expect(said).not.toMatch(/stay|left as|--|\u2014/);
    }
    expect(linesAlsoElsewhereNote([], "Leo Leaver", true)).toBeNull();
  });
});
