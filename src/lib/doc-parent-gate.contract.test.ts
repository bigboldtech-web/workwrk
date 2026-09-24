// A contract over the SOURCE of GET /api/docs/[id], because the route needs a
// database the unit suite does not have. It pins one promise: the parent page
// the response names (its crumb and Back link) is read through the SAME two
// gates as the doc itself. A sub-page carries no anchor of its own, so it can
// be readable while its parent is not, and the parent's title used to ride
// back to a viewer whose own GET of that parent answers 404.

import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const ROOT = fileURLToPath(new URL("../../", import.meta.url));
const ROUTE = readFileSync(path.join(ROOT, "src/app/api/docs/[id]/route.ts"), "utf8");

function body(name: string): string {
  const start = ROUTE.indexOf(`async function ${name}(`);
  expect(start, `${name} is missing`).toBeGreaterThanOrEqual(0);
  const open = ROUTE.indexOf("{\n", ROUTE.indexOf(")", ROUTE.indexOf("parentId: string", start)));
  let depth = 0;
  for (let i = open; i < ROUTE.length; i += 1) {
    if (ROUTE[i] === "{") depth += 1;
    else if (ROUTE[i] === "}" && (depth -= 1) === 0) return ROUTE.slice(open, i + 1);
  }
  throw new Error(`${name} never closes`);
}

describe("GET /api/docs/[id] names a parent page", () => {
  it("only through the parent's own read gates", () => {
    const fn = body("readableParent");
    expect(fn).toMatch(/organizationId:\s*ctx\.orgId/);
    expect(fn).toMatch(/docAccessible\(p,/);
    expect(fn).toMatch(/requireDocRole\(ctx,\s*\{\s*id:\s*p\.id,\s*createdById:\s*p\.createdById\s*\}\)/);
  });

  it("and the response's parent comes from that gate, never a bare lookup", () => {
    expect(ROUTE).toMatch(/doc\.parentId\s*\?\s*readableParent\(ctx,\s*doc\.parentId\)/);
    // No other read of the parent row by id alone.
    expect(ROUTE).not.toMatch(/where:\s*\{\s*id:\s*doc\.parentId/);
  });
});
