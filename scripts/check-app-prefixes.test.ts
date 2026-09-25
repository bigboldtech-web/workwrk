import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, describe, expect, it } from "vitest";

import { LISTS, findMissing, isRoutable, readList } from "./check-app-prefixes.mjs";

const REPO_ROOT = fileURLToPath(new URL("../", import.meta.url));
const at = (p: string) => path.join(REPO_ROOT, p);

// A throwaway route tree: one segment with a page of its own, one whose only
// page is nested two levels down (the shape of /work), and one with no page
// anywhere below it.
const fixture = mkdtempSync(path.join(tmpdir(), "app-prefixes-"));
const group = path.join(fixture, "(dashboard)");
function touch(rel: string) {
  const full = path.join(group, rel);
  mkdirSync(path.dirname(full), { recursive: true });
  writeFileSync(full, "export default function P() { return null }\n");
}
touch("flat/page.tsx");
touch("nested/docs/[id]/page.tsx");
touch("api-ish/[id]/route.ts");
mkdirSync(path.join(group, "empty", "deeper"), { recursive: true });
mkdirSync(path.join(group, "(group)"), { recursive: true });
touch("[dynamic]/page.tsx");

afterAll(() => rmSync(fixture, { recursive: true, force: true }));

describe("isRoutable", () => {
  it("counts a page or a route anywhere below the segment", () => {
    expect(isRoutable(path.join(group, "flat"))).toBe(true);
    expect(isRoutable(path.join(group, "nested"))).toBe(true);
    expect(isRoutable(path.join(group, "api-ish"))).toBe(true);
    expect(isRoutable(path.join(group, "empty"))).toBe(false);
    expect(isRoutable(path.join(group, "no-such-dir"))).toBe(false);
  });
});

describe("findMissing", () => {
  it("reports a nested-only segment the list does not name", () => {
    const missing = findMissing([group], new Set(["flat", "api-ish"]));
    expect(missing.map((m: string) => m.split(" ")[0])).toEqual(["nested"]);
  });

  it("never reports route groups, dynamic segments or a segment with no page", () => {
    expect(findMissing([group], new Set(["flat", "nested", "api-ish"]))).toEqual([]);
  });

  it("excuses a segment only through the list's written exemption", () => {
    expect(findMissing([group], new Set(["flat", "api-ish"]), new Map([["nested", "why"]]))).toEqual([]);
  });
});

describe("the real tree", () => {
  const proxy = readFileSync(at("src/proxy.ts"), "utf8");

  it("passes for both lists in src/proxy.ts", () => {
    for (const list of LISTS) {
      const allow = readList(proxy, list.name);
      expect(allow, list.name).not.toBeNull();
      expect(findMissing(list.groups.map(at), allow!, list.exempt), list.name).toEqual([]);
    }
  });

  it("would catch the Work door if it were missing from APP_PREFIXES", () => {
    const app = LISTS.find((l: { name: string }) => l.name === "APP_PREFIXES")!;
    const allow = new Set(readList(proxy, "APP_PREFIXES"));
    expect(allow.has("work")).toBe(true);
    allow.delete("work");
    const missing = findMissing(app.groups.map(at), allow, app.exempt);
    expect(missing.map((m: string) => m.split(" ")[0])).toEqual(["work"]);
  });

  it("exempts the foundations preview from the marketing list, and nothing else", () => {
    const marketing = LISTS.find((l: { name: string }) => l.name === "MARKETING_PREFIXES")!;
    expect([...marketing.exempt.keys()]).toEqual(["dev"]);
    const app = LISTS.find((l: { name: string }) => l.name === "APP_PREFIXES")!;
    expect(app.exempt.size).toBe(0);
  });
});
