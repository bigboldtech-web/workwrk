import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { LEGACY_TASK_ROUTES, legacyTaskDestination } from "./legacy-task-routes";
import { WORK_VIEWS } from "./my-work";

/**
 * The retired /tasks/* pages each land somewhere real. The Gantt and the
 * Sprint pages were the two the first redirect table sent to a plain
 * /my-work, which lost the view the bookmark named; they land on the view.
 */
describe("legacy /tasks/* destinations", () => {
  it("sends the personal Gantt and the sprint room to their My work views", () => {
    expect(legacyTaskDestination("/tasks/gantt")).toBe("/my-work?view=gantt");
    expect(legacyTaskDestination("/tasks/sprint")).toBe("/my-work?view=sprint");
  });

  it("names only views the My work switcher offers", () => {
    const keys = new Set(WORK_VIEWS.map((v) => v.key as string));
    for (const dest of Object.values(LEGACY_TASK_ROUTES)) {
      const m = /[?&]view=([a-z]+)/.exec(dest);
      if (m) expect(keys.has(m[1])).toBe(true);
    }
  });

  it("answers null for a path that is not a retired page", () => {
    expect(legacyTaskDestination("/tasks/cmu85g6g90004kzxp3il7t3b2")).toBeNull();
    expect(legacyTaskDestination("/my-work")).toBeNull();
  });

  it("agrees with the next.config.ts redirect table row for row", () => {
    const config = readFileSync(resolve(__dirname, "../../next.config.ts"), "utf8");
    for (const [source, destination] of Object.entries(LEGACY_TASK_ROUTES)) {
      const row = new RegExp(`source:\\s*"${source.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}",\\s*destination:\\s*"([^"]+)"`);
      const m = row.exec(config);
      expect(m, `${source} is missing from next.config.ts`).not.toBeNull();
      expect(m![1]).toBe(destination);
    }
  });

  it("agrees with the route-handler twins", () => {
    for (const source of Object.keys(LEGACY_TASK_ROUTES)) {
      const file = resolve(__dirname, `../app/(dashboard)${source}/route.ts`);
      const text = readFileSync(file, "utf8");
      const literal = new RegExp(`permanentRedirect\\("([^"]+)"\\)`).exec(text);
      const viaTable = text.includes(`LEGACY_TASK_ROUTES["${source}"]`);
      expect(viaTable || literal?.[1] === LEGACY_TASK_ROUTES[source], `${source} twin disagrees`).toBe(true);
    }
  });
});
