// A contract over the SOURCE of GET /api/docs/[id], because the route needs a
// database the unit suite does not have. It pins one promise: the parent page
// the response names (its crumb and Back link) is read through the SAME gate
// as the doc itself, docAccess (the one node-access resolver). A sub-page
// follows its parent (A6) but can carry a grant of its own, so it can be
// readable while its parent is not, and the parent's title used to ride back
// to a viewer whose own GET of that parent answers 404.

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
  it("only through the parent's own read gate", () => {
    const fn = body("readableParent");
    expect(fn).toMatch(/organizationId:\s*ctx\.orgId/);
    expect(fn).toMatch(/docAccess\(nodeCtxFromLevel\(ctx\.userId,\s*ctx\.orgId,\s*ctx\.accessLevel\),\s*p\.id\)/);
    // The doc's own GET reads through the same gate.
    expect(ROUTE).toMatch(/const access = await docAccess\(nodeCtxFromLevel\(ctx\.userId, ctx\.orgId, ctx\.accessLevel\), doc\.id\)/);
  });

  it("and the response's parent comes from that gate, never a bare lookup", () => {
    expect(ROUTE).toMatch(/doc\.parentId\s*\?\s*readableParent\(ctx,\s*doc\.parentId\)/);
    // No other read of the parent row by id alone.
    expect(ROUTE).not.toMatch(/where:\s*\{\s*id:\s*doc\.parentId/);
  });
});
