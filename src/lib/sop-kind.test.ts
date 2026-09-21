import { describe, expect, it } from "vitest";
import {
  allRequiredDone,
  checklistAsksFor,
  countSteps,
  defaultContentForKind,
  getSopKind,
  getSopLayout,
  kindWhere,
  missingRequired,
  runProgress,
  sopTypeForKind,
} from "./sop-kind";

describe("getSopKind", () => {
  it("decodes the four kinds from the two axes", () => {
    expect(getSopKind("CHECKLIST", { type: "CHECKLIST" })).toBe("checklist");
    expect(getSopKind("CHECKLIST", { type: "blocks" })).toBe("checklist");
    expect(getSopKind("RECORDED", { type: "recorded" })).toBe("recording");
    expect(getSopKind("WRITTEN", { type: "recorded" })).toBe("recording");
    expect(getSopKind("WRITTEN", { type: "RECORDED" })).toBe("recording");
    expect(getSopKind("WRITTEN", { type: "blocks" })).toBe("written");
    expect(getSopKind("WRITTEN", { type: "WRITTEN", body: "" })).toBe("written");
    expect(getSopKind("WRITTEN", { type: "richtext", html: "" })).toBe("written");
    expect(getSopKind("WRITTEN", { type: "steps", steps: [] })).toBe("steps");
    expect(getSopKind("WRITTEN", { type: "process_flow" })).toBe("steps");
    expect(getSopKind("WRITTEN", { steps: [] })).toBe("steps");
    expect(getSopKind("WRITTEN", null)).toBe("steps");
  });
  it("round-trips through sopTypeForKind and defaultContentForKind", () => {
    for (const kind of ["written", "steps", "checklist", "recording"] as const) {
      expect(getSopKind(sopTypeForKind(kind), defaultContentForKind(kind))).toBe(kind);
    }
  });
});

describe("getSopLayout", () => {
  it("reads content.layout and treats legacy process_flow as flow", () => {
    expect(getSopLayout({ type: "steps" })).toBe("list");
    expect(getSopLayout({ type: "steps", layout: "flow" })).toBe("flow");
    expect(getSopLayout({ type: "process_flow" })).toBe("flow");
    expect(getSopLayout({ type: "process_flow", layout: "list" })).toBe("list");
    expect(getSopLayout(null)).toBe("list");
  });
});

describe("kindWhere", () => {
  it("narrows on sopType for checklists and on the content tag for the written kinds", () => {
    expect(kindWhere("checklist")).toEqual({ sopType: "CHECKLIST" });
    expect(kindWhere("written")).toMatchObject({ sopType: "WRITTEN" });
    expect(kindWhere("steps")).toMatchObject({ sopType: "WRITTEN", NOT: expect.anything() });
    expect(kindWhere("recording")).toHaveProperty("OR");
  });
});

describe("checklist read helpers", () => {
  it("summarises the inputs a step asks for", () => {
    expect(checklistAsksFor([])).toBe("");
    expect(checklistAsksFor([{ type: "email", label: "" }, { type: "file_upload", label: "Photo" }])).toBe("Asks for: Email, Photo");
  });
  it("counts steps and progress", () => {
    const sections = [{ steps: [{ id: "a" }, { id: "b" }] }, { steps: [{ id: "c" }] }];
    expect(countSteps(sections)).toBe(3);
    expect(runProgress(sections, ["a", "c", "zzz"])).toEqual({ done: 2, total: 3, pct: 67 });
    expect(runProgress([], [])).toEqual({ done: 0, total: 0, pct: 0 });
    expect(allRequiredDone(sections, ["a", "b"])).toBe(false);
    expect(allRequiredDone(sections, ["a", "b", "c"])).toBe(true);
    expect(allRequiredDone([], [])).toBe(false);
  });
  it("names the required inputs still empty", () => {
    const step = { inputs: [{ id: "x", required: true }, { id: "y", required: false }, { id: "z", required: true }] };
    expect(missingRequired(step, { x: "ok", z: [] })).toEqual(["z"]);
    expect(missingRequired(step, null)).toEqual(["x", "z"]);
    expect(missingRequired(step, { x: 0, z: "a" })).toEqual([]);
  });
});
