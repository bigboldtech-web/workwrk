import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { DEEP_RESTRICTED, HARD_DELETE_FIRST } from "./hard-delete-order";

// The schema, read the way the database was built from it: a required
// relation with no onDelete restricts, and so does onDelete: Restrict or
// NoAction.
interface Rel { field: string; target: string; optional: boolean; onDelete: string | null }
const schema = readFileSync(path.join(process.cwd(), "prisma", "schema.prisma"), "utf8");
const models = new Map<string, Rel[]>();
for (const m of schema.matchAll(/^model (\w+) \{([\s\S]*?)^\}/gm)) {
  const rels: Rel[] = [];
  for (const line of m[2].split("\n")) {
    const f = /^\s+(\w+)\s+(\w+)(\?)?\s+@relation\(([^)]*)\)/.exec(line);
    if (!f || !/\bfields:/.test(f[4])) continue;
    rels.push({ field: f[1], target: f[2], optional: !!f[3], onDelete: /onDelete:\s*(\w+)/.exec(f[4])?.[1] ?? null });
  }
  models.set(m[1], rels);
}
const restricts = (r: Rel) => r.onDelete === "Restrict" || r.onDelete === "NoAction" || (!r.optional && r.onDelete === null);
const cascadesFrom = (model: string) => (models.get(model) ?? []).filter((r) => r.onDelete === "Cascade").map((r) => r.target);
const underCompany = (model: string) => cascadesFrom(model).includes("Organization");

/** The parents a model cascades from, up to three levels, nearest first. */
function chain(model: string, depth = 3): string[] {
  if (depth === 0) return [];
  return cascadesFrom(model).flatMap((p) => [p, ...chain(p, depth - 1)]);
}

describe("the order of a hard delete", () => {
  it("reads the schema", () => {
    expect(models.size).toBeGreaterThan(100);
    expect(underCompany("User")).toBe(true);
  });

  it("covers every restricting link to an account or a company record that sits deeper than one level", () => {
    const missing: string[] = [];
    for (const [model, rels] of models) {
      if (model === "Organization" || underCompany(model)) continue;
      const blocking = rels.filter((r) => restricts(r) && (r.target === "User" || underCompany(r.target)));
      if (blocking.length === 0) continue;
      const parent = DEEP_RESTRICTED[model];
      if (!parent || !chain(model).includes(parent)) missing.push(`${model} (${blocking.map((b) => `${b.field} -> ${b.target}`).join(", ")})`);
    }
    expect(missing).toEqual([]);
  });

  it("deletes each first parent by its own company link", () => {
    for (const parent of HARD_DELETE_FIRST) expect(underCompany(parent), parent).toBe(true);
    for (const [model, parent] of Object.entries(DEEP_RESTRICTED)) expect(chain(model), model).toContain(parent);
  });
});
