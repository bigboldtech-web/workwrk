import { describe, expect, it } from "vitest";
import { goneBody, RETIRED_TASK_ROUTES } from "./legacy-task-api";

describe("the retired /api/tasks* table", () => {
  it("covers every route that was retired, and nothing else", () => {
    expect(Object.keys(RETIRED_TASK_ROUTES).sort()).toEqual([
      "/api/tasks",
      "/api/tasks/[id]/comments",
      "/api/tasks/batch",
      "/api/tasks/reorder-day",
      "/api/tasks/run-sla-check",
      "/api/tasks/workload",
    ]);
  });

  it("gives every row a detail sentence a person can act on", () => {
    for (const [route, row] of Object.entries(RETIRED_TASK_ROUTES)) {
      expect(row.detail.length, `${route} has no detail`).toBeGreaterThan(40);
      // Never a bare "this is gone" with nowhere to go: a row with no
      // replacement must say in words why nothing replaces it.
      if (row.replacement === null) {
        expect(row.detail.toLowerCase()).toMatch(/nothing replaces it|needs no route/);
      }
    }
  });

  it("only ever names an in-app path as the replacement", () => {
    for (const [route, row] of Object.entries(RETIRED_TASK_ROUTES)) {
      if (row.replacement === null) continue;
      expect(row.replacement.startsWith("/api/"), `${route} -> ${row.replacement}`).toBe(true);
    }
  });

  it("never points a retired route back at another retired one", () => {
    const retired = new Set(Object.keys(RETIRED_TASK_ROUTES));
    for (const [route, row] of Object.entries(RETIRED_TASK_ROUTES)) {
      if (row.replacement === null) continue;
      expect(retired.has(row.replacement), `${route} forwards to the retired ${row.replacement}`).toBe(false);
    }
  });
});

describe("goneBody", () => {
  it("names what went and where it went", () => {
    expect(goneBody("/api/tasks", "/api/me/work", "Tasks live on the Item model.")).toEqual({
      error: "Gone",
      retired: "/api/tasks",
      replacement: "/api/me/work",
      detail: "Tasks live on the Item model.",
    });
  });

  it("allows a null replacement for a capability that is genuinely retired", () => {
    expect(goneBody("/api/tasks/workload", null, "No route needed.").replacement).toBeNull();
  });
});
