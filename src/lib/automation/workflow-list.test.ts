import { describe, expect, it } from "vitest";
import { filterWorkflows, pageOf, parseOffsetCursor, parseSort, parseTake, parseView, scopeTouches, sortWorkflows, type ListRow } from "./workflow-list";
import { readScope } from "./definition";

function row(p: Partial<ListRow> & { id: string }): ListRow {
  return {
    name: p.id,
    status: "ACTIVE",
    severity: "MINOR",
    triggerEvent: "task.created",
    createdById: "u1",
    updatedAt: "2026-09-01T00:00:00Z",
    lastRunAt: null,
    successRate: null,
    definition: {},
    ...p,
  };
}

describe("parse helpers", () => {
  it("falls back to the defaults on junk", () => {
    expect(parseView("nope")).toBe("all");
    expect(parseView("paused")).toBe("paused");
    expect(parseSort("")).toBe("updated");
    expect(parseTake("9999")).toBe(100);
    expect(parseTake("x")).toBe(40);
    expect(parseOffsetCursor("-3")).toBe(0);
    expect(parseOffsetCursor("40")).toBe(40);
  });
});

describe("filterWorkflows", () => {
  const rows = [
    row({ id: "a", status: "ACTIVE" }),
    row({ id: "b", status: "DRAFT", createdById: "u2" }),
    row({ id: "c", status: "INACTIVE", severity: "CRITICAL" }),
    row({ id: "d", status: "ARCHIVED" }),
    row({ id: "e", status: "ACTIVE", definition: { scope: { listIds: ["L1"] } } }),
  ];

  it("the All view hides archived rows unless Show archived is on", () => {
    expect(filterWorkflows(rows, { view: "all", showArchived: false }).map((r) => r.id)).toEqual(["a", "b", "c", "e"]);
    expect(filterWorkflows(rows, { view: "all", showArchived: true }).map((r) => r.id)).toContain("d");
  });

  it("the status views map to the API statuses (Paused is INACTIVE)", () => {
    expect(filterWorkflows(rows, { view: "paused", showArchived: false }).map((r) => r.id)).toEqual(["c"]);
    expect(filterWorkflows(rows, { view: "drafts", showArchived: false }).map((r) => r.id)).toEqual(["b"]);
  });

  it("filters by creator, alert level and where it runs", () => {
    expect(filterWorkflows(rows, { view: "all", showArchived: false, createdBy: ["u2"] }).map((r) => r.id)).toEqual(["b"]);
    expect(filterWorkflows(rows, { view: "all", showArchived: false, severities: ["CRITICAL"] }).map((r) => r.id)).toEqual(["c"]);
    expect(filterWorkflows(rows, { view: "all", showArchived: false, where: ["L1"] }).map((r) => r.id)).toEqual(["e"]);
    expect(filterWorkflows(rows, { view: "all", showArchived: false, where: ["everywhere"] }).map((r) => r.id)).toEqual(["a", "b", "c"]);
  });

  it("a container from a List menu shows only the automations scoped there", () => {
    expect(filterWorkflows(rows, { view: "all", showArchived: false, container: { kind: "list", id: "L1" } }).map((r) => r.id)).toEqual(["e"]);
  });
});

describe("scopeTouches", () => {
  it("a Space container matches a workflow scoped to a List inside it", () => {
    const scope = readScope({ scope: { listIds: ["L1"] } });
    expect(scopeTouches(scope, { kind: "space", id: "S1", listIds: ["L1"] })).toBe(true);
    expect(scopeTouches(scope, { kind: "space", id: "S1", listIds: ["L2"] })).toBe(false);
    expect(scopeTouches(readScope({ scope: { spaceIds: ["S1"] } }), { kind: "space", id: "S1" })).toBe(true);
  });
});

describe("sortWorkflows", () => {
  const rows = [
    row({ id: "a", name: "Beta", successRate: 50, lastRunAt: "2026-09-02T00:00:00Z" }),
    row({ id: "b", name: "alpha", successRate: null, lastRunAt: null }),
    row({ id: "c", name: "Gamma", successRate: 100, lastRunAt: "2026-09-03T00:00:00Z" }),
  ];

  it("sorts by name case-insensitively", () => {
    expect(sortWorkflows(rows, "name").map((r) => r.id)).toEqual(["b", "a", "c"]);
  });

  it("puts workflows with no runs after every real success rate", () => {
    expect(sortWorkflows(rows, "success").map((r) => r.id)).toEqual(["c", "a", "b"]);
  });

  it("sorts by last run newest first, never-run last", () => {
    expect(sortWorkflows(rows, "lastRun").map((r) => r.id)).toEqual(["c", "a", "b"]);
  });
});

describe("pageOf", () => {
  const rows = Array.from({ length: 45 }, (_, i) => i);

  it("returns the page, the real total and the next cursor", () => {
    const p = pageOf(rows, 0, 40);
    expect(p.page).toHaveLength(40);
    expect(p.total).toBe(45);
    expect(p.nextCursor).toBe("40");
    const q = pageOf(rows, 40, 40);
    expect(q.page).toEqual([40, 41, 42, 43, 44]);
    expect(q.nextCursor).toBeNull();
  });

  it("a cursor past the end lands on the last real page", () => {
    expect(pageOf(rows, 400, 40).offset).toBe(40);
    expect(pageOf([], 80, 40).page).toEqual([]);
  });
});
