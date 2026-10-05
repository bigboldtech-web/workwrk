import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { DEEP_RESTRICTED, HARD_DELETE_FIRST } from "./hard-delete-order";

// The schema, read the way the database was built from it: a required
// relation with no onDelete restricts, and so do onDelete: Restrict and
// NoAction.
interface Rel { owner: string; field: string; target: string; optional: boolean; onDelete: string | null; fields: string }
const schema = readFileSync(path.join(process.cwd(), "prisma", "schema.prisma"), "utf8");
const models = new Map<string, Rel[]>();
for (const m of schema.matchAll(/^model (\w+) \{([\s\S]*?)^\}/gm)) {
  const rels: Rel[] = [];
  for (const line of m[2].split("\n")) {
    const f = /^\s+(\w+)\s+(\w+)(\?)?\s+@relation\(([^)]*)\)/.exec(line);
    const fields = f ? /fields:\s*\[([^\]]*)\]/.exec(f[4]) : null;
    if (!f || !fields) continue;
    rels.push({ owner: m[1], field: f[1], target: f[2], optional: !!f[3], onDelete: /onDelete:\s*(\w+)/.exec(f[4])?.[1] ?? null, fields: fields[1].trim() });
  }
  models.set(m[1], rels);
}
const allRels = [...models.values()].flat();
const restricts = (r: Rel) => r.onDelete === "Restrict" || r.onDelete === "NoAction" || (!r.optional && r.onDelete === null);
const cascadesFrom = (model: string) => (models.get(model) ?? []).filter((r) => r.onDelete === "Cascade").map((r) => r.target);
const underCompany = (model: string) => cascadesFrom(model).includes("Organization");

/** The parents a model cascades from, up to four levels, nearest first. */
function chain(model: string, depth = 4): string[] {
  if (depth === 0) return [];
  return cascadesFrom(model).flatMap((p) => [p, ...chain(p, depth - 1)]);
}
/** Deleted by the company's own cascade: some chain reaches Organization. */
const goesWithCompany = (model: string) => model === "User" || chain(model).includes("Organization");
/** A first parent and every model that cascades from it. */
const subtree = (parent: string) => new Set([parent, ...[...models.keys()].filter((m) => chain(m).includes(parent))]);

describe("the order of a hard delete", () => {
  it("reads the schema", () => {
    expect(models.size).toBeGreaterThan(100);
    expect(underCompany("User")).toBe(true);
    expect(subtree("ReviewCycle").has("PeerFeedback")).toBe(true);
  });

  it("covers every restricting link from a record below the first level to one the company's delete removes", () => {
    const missing: string[] = [];
    for (const [model, rels] of models) {
      if (model === "Organization" || underCompany(model)) continue;
      const blocking = rels.filter((r) => restricts(r) && goesWithCompany(r.target));
      if (blocking.length === 0) continue;
      const parent = DEEP_RESTRICTED[model];
      if (!parent || !chain(model).includes(parent)) missing.push(`${model} (${blocking.map((b) => `${b.field} -> ${b.target}`).join(", ")})`);
    }
    expect(missing).toEqual([]);
  });

  it("has no restricting link into a first parent's records from outside them (their own delete would fail)", () => {
    const blocked: string[] = [];
    HARD_DELETE_FIRST.forEach((parent, i) => {
      const inside = subtree(parent);
      const earlier = new Set(HARD_DELETE_FIRST.slice(0, i).flatMap((p) => [...subtree(p)]));
      for (const r of allRels) {
        if (!restricts(r) || !inside.has(r.target) || earlier.has(r.owner)) continue;
        blocked.push(`${r.owner}.${r.field} -> ${r.target} (inside ${parent})`);
      }
    });
    expect(blocked).toEqual([]);
  });

  it("deletes each first parent by its organizationId column", () => {
    for (const parent of HARD_DELETE_FIRST) {
      const company = (models.get(parent) ?? []).find((r) => r.target === "Organization" && r.onDelete === "Cascade");
      expect(company?.fields, parent).toBe("organizationId");
    }
    for (const [model, parent] of Object.entries(DEEP_RESTRICTED)) expect(chain(model), model).toContain(parent);
  });
});
