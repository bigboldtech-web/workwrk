import { describe, expect, it } from "vitest";
import { GROUP_COPY } from "./teammate-copy";
import { GROUP_LIMITS, groupNameFrom, leadOf, memberProblem, namedIn, pickAnswerers, skipReasonOf, type GroupMember } from "./group-chat";

let n = 0;
function member(name: string, over: Partial<GroupMember> = {}): GroupMember {
  n += 1;
  return { agentId: `a${n}`, slug: name.toLowerCase().replace(/\W+/g, "-"), name, template: null, position: n, status: "ENABLED", usable: true, ...over };
}

const names = (ms: readonly GroupMember[]) => ms.map((m) => m.name);

describe("skipReasonOf", () => {
  it("names why a member cannot answer, removed before no access before paused", () => {
    expect(skipReasonOf(member("A"))).toBeNull();
    expect(skipReasonOf(member("A", { status: "DISABLED" }))).toBe("paused");
    expect(skipReasonOf(member("A", { usable: false }))).toBe("no_access");
    expect(skipReasonOf(member("A", { status: "ARCHIVED", usable: false }))).toBe("removed");
    expect(skipReasonOf(member("A", { status: "DISABLED", usable: false }))).toBe("no_access");
  });
});

describe("who answers a message that names nobody", () => {
  it("is the Chief of Staff when the group has one, else the first by position", () => {
    const pm = member("Project Manager", { position: 0 });
    const cos = member("Chief of Staff", { position: 2, template: "chief-of-staff" });
    const triage = member("Triage", { position: 1 });
    expect(leadOf([triage, cos, pm])?.name).toBe("Chief of Staff");
    expect(leadOf([triage, pm])?.name).toBe("Project Manager");
    expect(pickAnswerers("Status?", [triage, cos, pm])).toEqual({ named: false, answerers: [{ member: cos, skip: null }] });
  });
  it("falls to the next answerable member when the lead is paused", () => {
    const cos = member("Chief of Staff", { position: 0, template: "chief-of-staff", status: "DISABLED" });
    const pm = member("Project Manager", { position: 1, status: "ARCHIVED" });
    const triage = member("Triage", { position: 2 });
    expect(leadOf([cos, pm, triage])?.name).toBe("Triage");
  });
  it("is nobody when no member can answer", () => {
    const ms = [member("A", { status: "DISABLED" }), member("B", { usable: false })];
    expect(leadOf(ms)).toBeNull();
    expect(pickAnswerers("Hello", ms)).toEqual({ named: false, answerers: [] });
  });
});

describe("namedIn", () => {
  const pm = member("Project Manager");
  const triage = member("Triage");
  const cos = member("Chief of Staff");
  const analyst = member("Market Analyst");
  const all = [pm, triage, cos, analyst];

  it("keeps the order the message names them in", () => {
    expect(names(namedIn("@Triage then @Project Manager, what is late?", all))).toEqual(["Triage", "Project Manager"]);
  });
  it("gives the first three of four names", () => {
    expect(names(namedIn("@Market Analyst @Triage @Chief of Staff @Project Manager", all))).toEqual(["Market Analyst", "Triage", "Chief of Staff"]);
    expect(GROUP_LIMITS.maxAnswerers).toBe(3);
  });
  it("tries longer names first, so @PM Lead never also counts as @PM", () => {
    const p = member("PM");
    const lead = member("PM Lead");
    expect(names(namedIn("@PM Lead, sum up", [p, lead]))).toEqual(["PM Lead"]);
    expect(names(namedIn("@PM and @PM Lead", [p, lead]))).toEqual(["PM", "PM Lead"]);
  });
  it("ignores case", () => {
    expect(names(namedIn("@project manager hi", all))).toEqual(["Project Manager"]);
  });
  it("needs the name to end where the word does", () => {
    expect(namedIn("@Project Managers, hello", all)).toEqual([]);
    expect(namedIn("@Triage_bot hello", all)).toEqual([]);
    expect(names(namedIn("@Triage, hello", all))).toEqual(["Triage"]);
    expect(names(namedIn("ask @Triage.", all))).toEqual(["Triage"]);
  });
  it("names nobody inside an email address", () => {
    expect(namedIn("Write to bob@triage.com", all)).toEqual([]);
  });
  it("counts each member once", () => {
    expect(names(namedIn("@Triage @triage @Triage", all))).toEqual(["Triage"]);
  });
  it("prefers the member that can answer when a removed one has the same name", () => {
    const gone = member("Triage", { status: "ARCHIVED", position: 0 });
    const live = member("Triage", { position: 3 });
    expect(namedIn("@Triage hi", [gone, live])).toEqual([live]);
  });
});

describe("pickAnswerers", () => {
  it("returns a named paused member with its reason, for a skipped line", () => {
    const pm = member("Project Manager");
    const triage = member("Triage", { status: "DISABLED" });
    expect(pickAnswerers("@Triage hi", [pm, triage])).toEqual({ named: true, answerers: [{ member: triage, skip: "paused" }] });
  });
});

describe("memberProblem", () => {
  const m = (name: string, status?: string) => ({ name, status });
  it("counts only members still in the workspace", () => {
    expect(memberProblem([m("A")])).toBe("too_few");
    expect(memberProblem([m("A"), m("B", "ARCHIVED")])).toBe("too_few");
    expect(memberProblem([m("A"), m("B")])).toBeNull();
    expect(memberProblem(["A", "B", "C", "D", "E"].map((x) => m(x)))).toBeNull();
    expect(memberProblem(["A", "B", "C", "D", "E", "F"].map((x) => m(x)))).toBe("too_many");
  });
  it("refuses two members sharing a name, without case", () => {
    expect(memberProblem([m("PM"), m("pm")])).toBe("duplicate_name");
    expect(memberProblem([m("PM"), m(" PM ")])).toBe("duplicate_name");
    expect(memberProblem([m("PM"), m("PM", "ARCHIVED"), m("Triage")])).toBeNull();
  });
});

describe("groupNameFrom", () => {
  it("names a group with no name after its first three teammates", () => {
    expect(groupNameFrom("", ["A", "B", "C", "D"])).toBe("A, B and C");
    expect(groupNameFrom("   ", ["Chief of Staff", "Market Analyst"])).toBe("Chief of Staff and Market Analyst");
    expect(groupNameFrom(null, ["A", "B"])).toBe(GROUP_COPY.groupDefaultName(["A", "B"]));
  });
  it("trims a given name and cuts it to 60", () => {
    expect(groupNameFrom("  Offsite crew  ", ["A", "B"])).toBe("Offsite crew");
    expect(groupNameFrom("x".repeat(80), ["A", "B"])).toHaveLength(60);
    expect(groupNameFrom("", ["x".repeat(40), "y".repeat(40)]).length).toBeLessThanOrEqual(60);
  });
});
