// Search matches tasks and Lists only among the Lists the viewer can open,
// in the query itself (launch audit, 2026-10-31). It used to take the newest
// matches across the whole workspace and filter afterwards, so a member whose
// newest matches sat in PRIVATE Lists found no task at all. Read from the
// source, as the route reads sixteen kinds of record at once.

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const src = readFileSync(join(process.cwd(), "src/app/api/search/route.ts"), "utf8");

describe("search reads only openable Lists' tasks and Lists", () => {
  it("resolves the viewer's readable Lists once, before the reads, and not for an admin", () => {
    expect(src).toMatch(/const readableListIds = admin\s*\? null\s*: \[\.\.\.\(await idsWithRole\(\s*nodeCtx,\s*"list",/);
    expect(src.indexOf("const readableListIds")).toBeLessThan(src.indexOf("prisma.item.findMany"));
  });

  it("keeps a task of a readable List, or one the viewer owns or is assigned, in the item read", () => {
    expect(src).toMatch(/\.\.\.\(readableListIds \? \{ OR: \[\{ boardId: \{ in: readableListIds \} \}, \{ ownerId: me \}, \{ assigneeIds: \{ has: me \} \}\] \} : \{\}\)/);
  });

  it("keeps only readable Lists in the List read, and still filters every row afterwards", () => {
    expect(src).toMatch(/\.\.\.\(readableListIds \? \{ id: \{ in: readableListIds \} \} : \{\}\)/);
    expect(src).toMatch(/const visibleItems = items\s*\.filter\(\(it\) => opens\(\{ kind: "list", id: it\.boardId \}\)/);
  });
});
