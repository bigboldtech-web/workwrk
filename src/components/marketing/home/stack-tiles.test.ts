import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// The home page's module grid ("The platform" band) is part of the marketing
// site the founder approved on 2026-09-22. The sweep that took raw hex out of
// stack.tsx was allowed to change exactly one tile, AI, from purple to the
// brand blue. Every other tile must still draw the colour it drew then.
//
// The first sweep broke that silently: it pointed Planner, Goals, Talk,
// Tables and Teams at the semantic warning, success and danger tokens, which
// hold different values, and the orange tiles turned yellow and brown. A
// token that LOOKS right is not checked by tsc or by the no-raw-hex rule, so
// this test resolves every tile's token through the marketing scope and
// compares the result with the approved value.
//
// TILE_STACK_SRC and TILE_CSS_SRC point the test at other copies of the two
// files, which is how it was shown to fail on the version before the fix.

const ROOT = join(__dirname, "..", "..", "..", "..");
const STACK = process.env.TILE_STACK_SRC ?? join(ROOT, "src", "components", "marketing", "home", "stack.tsx");
const SHEET =
  process.env.TILE_CSS_SRC ?? join(ROOT, "src", "components", "marketing", "shell", "marketing-shell.css");

/** The approved grid, read from production's computed styles. AI is the one approved change. */
const APPROVED: Record<string, { bg: string; fg: string }> = {
  work: { bg: "#EAF3FE", fg: "#0B5FC2" },
  docs: { bg: "#EAF3FE", fg: "#0B5FC2" },
  planner: { bg: "#FFF4E5", fg: "#B25E02" },
  goals: { bg: "#FFF4E5", fg: "#B25E02" },
  talk: { bg: "#E8F8EF", fg: "#12734A" },
  tables: { bg: "#E8F8EF", fg: "#12734A" },
  teams: { bg: "#FFEFEF", fg: "#B42318" },
  // Was #F3EEFF on #5B3DC4 (purple). Moved to the brand blue on purpose.
  ai: { bg: "#EAF3FE", fg: "#0B5FC2" },
};

/** Custom properties declared in the `.mk-tokens, .mk-os` scope, comments stripped. */
function scopeTokens(css: string): Record<string, string> {
  const clean = css.replace(/\/\*[\s\S]*?\*\//g, "");
  const out: Record<string, string> = {};
  const re = /(^|\n)([^{}@]+)\{([^{}]*)\}/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(clean)) !== null) {
    const selectors = m[2].split(",").map((s) => s.trim());
    if (!selectors.includes(".mk-tokens")) continue;
    for (const decl of m[3].matchAll(/(--[A-Za-z0-9-]+)\s*:\s*([^;]+);/g)) out[decl[1]] = decl[2].trim();
  }
  return out;
}

/** `var(--x)` to its literal, following aliases. Unresolvable values come back as written. */
function resolve(tokens: Record<string, string>, value: string, depth = 0): string {
  const m = value.match(/^var\((--[A-Za-z0-9-]+)\)$/);
  if (!m || depth > 5) return value;
  const next = tokens[m[1]];
  return next === undefined ? value : resolve(tokens, next, depth + 1);
}

/** The TILE map in stack.tsx, as hub id to its bg and fg values. */
function tileMap(src: string): Record<string, { bg: string; fg: string }> {
  const block = src.match(/const TILE[^=]*=\s*\{([\s\S]*?)\n\};/);
  if (!block) throw new Error("TILE map not found in stack.tsx");
  const out: Record<string, { bg: string; fg: string }> = {};
  for (const m of block[1].matchAll(/(\w+):\s*\{\s*bg:\s*"([^"]+)",\s*fg:\s*"([^"]+)"\s*\}/g)) {
    out[m[1]] = { bg: m[2], fg: m[3] };
  }
  return out;
}

describe("the home page module tiles", () => {
  const tokens = scopeTokens(readFileSync(SHEET, "utf8"));
  const tiles = tileMap(readFileSync(STACK, "utf8"));

  it("finds every hub tile", () => {
    expect(Object.keys(tiles).sort()).toEqual(Object.keys(APPROVED).sort());
  });

  it("reads tokens, never literals", () => {
    for (const [hub, { bg, fg }] of Object.entries(tiles)) {
      expect(bg, `${hub} bg`).toMatch(/^var\(--[A-Za-z0-9-]+\)$/);
      expect(fg, `${hub} fg`).toMatch(/^var\(--[A-Za-z0-9-]+\)$/);
    }
  });

  it("draws every tile in the approved colour", () => {
    const drift: string[] = [];
    for (const [hub, want] of Object.entries(APPROVED)) {
      const tile = tiles[hub];
      if (!tile) continue;
      const bg = resolve(tokens, tile.bg).toUpperCase();
      const fg = resolve(tokens, tile.fg).toUpperCase();
      if (bg !== want.bg) drift.push(`${hub} bg ${tile.bg} = ${bg}, approved ${want.bg}`);
      if (fg !== want.fg) drift.push(`${hub} fg ${tile.fg} = ${fg}, approved ${want.fg}`);
    }
    expect(drift).toEqual([]);
  });
});
