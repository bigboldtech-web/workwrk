// Source contracts for the Space server code Bird's eye added or changed:
// the ONE readable-List predicate, the ONE Space.settings writer, and the
// routes and page that must go through them.
//
// None of it can run here (Prisma, next-auth, a database), so this reads the
// files and pins what a later edit could quietly undo:
//
//   * readableListsInSpace answers from the one resolver's tree (node-access
//     spaceTree, or the tree the caller already built), reads no member table
//     and no second predicate, and takes the columns it needs from one
//     org-scoped read of exactly the readable Lists;
//   * every Space.settings writer (bookmarks, the module toggle, the pin)
//     goes through mutateSpaceSettings, which locks the row FOR UPDATE and
//     merges over what it locked;
//   * the page, GET /api/boards and the Bird's eye route pick their Lists with
//     that one predicate; the two new routes never read the legacy signal;
//   * Bird's eye returns before any Overview, List, Board, Team, Calendar or
//     Gantt query runs.

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = process.cwd();
const code = (rel: string) =>
  readFileSync(join(ROOT, rel), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/.*$/gm, "$1");

function between(src: string, from: string, to: string): string {
  const start = src.indexOf(from);
  expect(start, from).toBeGreaterThan(-1);
  const end = src.indexOf(to, start + from.length);
  return src.slice(start, end > -1 ? end : undefined);
}

const SPACE = code("src/lib/space.ts");

describe("readableListsInSpace", () => {
  const body = between(SPACE, "export async function readableListsInSpace", "\nexport ");

  it("answers from the one resolver's tree, or the tree the caller already built", () => {
    expect(body).toMatch(/const tree = opts\.tree !== undefined \? opts\.tree : await spaceTree\(ctx, spaceId\);/);
    expect(body).toMatch(/if \(!tree\) return \{ lists: \[\], folderCount: 0 \};/);
  });

  it("reads no member table and no second predicate", () => {
    expect(body).not.toMatch(/prisma\.(spaceMember|folderMember|boardMember)/);
    expect(body).not.toMatch(/members: \{/);
    expect(SPACE).not.toMatch(/decideSpaceLists|accessibleFolderIds|legacyAllows/);
  });

  it("takes the columns from one org-scoped read of exactly the readable Lists", () => {
    expect(body).toMatch(/prisma\.board\.findMany\(\{\s*where: \{ id: \{ in: ordered\.map\(\(o\) => o\.node\.id\) \}, organizationId: viewer\.organizationId, archivedAt: null \}/);
    expect(body.match(/prisma\./g)?.length).toBe(1);
  });

  it("walks child folders before a folder's Lists and the root Lists last, the sidebar's order", () => {
    expect(body).toMatch(/walk\(f\.childFolders\);\s*for \(const l of f\.boards\) ordered\.push/);
    expect(body).toMatch(/for \(const l of tree\.boards\) ordered\.push\(\{ node: l, folderId: null \}\);/);
    expect(body).toMatch(/const folderCount = renderedCounts\(tree\)\.folders;/);
  });
});

describe("the one Space.settings writer", () => {
  const writer = between(SPACE, "export async function mutateSpaceSettings", "\nexport ");

  it("locks the row, decides on what it locked, and merges over it", () => {
    expect(writer).toMatch(/prisma\.\$transaction\(async \(tx\) =>/);
    expect(writer).toMatch(/SELECT "settings" FROM "Space" WHERE "id" = \$\{spaceId\} FOR UPDATE/);
    expect(writer).toMatch(/const out = fn\(locked\);/);
    expect(writer).toMatch(/mergeSpaceSettings\(locked, out\.patch\)/);
  });

  it("carries the module toggle, which can no longer drop a pin", () => {
    const update = between(SPACE, "export async function updateSpace", "\nexport ");
    expect(update).toMatch(/mutateSpaceSettings\(spaceId, \(s\) => \(\{ patch: spaceModulesPatch\(s, modules\), result: null \}\), data\)/);
    expect(update).not.toMatch(/prisma\.space\.findUnique\(\{ where: \{ id: spaceId \}, select: \{ settings: true \} \}\)/);
  });

  it("carries the bookmarks, decided on the locked settings", () => {
    const route = code("src/app/api/spaces/[id]/bookmarks/route.ts");
    expect(route).not.toMatch(/writeBookmarks/);
    expect(route).not.toMatch(/prisma\.space\.update/);
    expect(route.match(/mutateSpaceSettings\(id, \(locked\) =>/g)?.length).toBe(2);
    expect(route).toMatch(/const bookmarks = readBookmarks\(locked\);\s*if \(bookmarks\.length >= MAX_BOOKMARKS\)/);
  });

  it("carries the Space pin, refusing a hidden view on the locked settings", () => {
    const route = code("src/app/api/spaces/[id]/default-view/route.ts");
    expect(route).toMatch(/mutateSpaceSettings\(g\.spaceId, \(settings\) =>\s*hiddenSpaceViews\(settings\)\.includes\(view\)/);
    expect(route).toMatch(/patch: \{ defaultView: null \}/);
  });
});

describe("the routes Bird's eye added never read the legacy signal", () => {
  for (const rel of ["src/app/api/spaces/[id]/birdseye/route.ts", "src/app/api/spaces/[id]/default-view/route.ts"]) {
    it(rel, () => {
      const src = code(rel);
      expect(src).not.toMatch(/accessLevel/);
      expect(src).not.toMatch(/getServerSession/);
      expect(src).not.toMatch(/prisma\./);
      expect(src).toMatch(/await itemCtx\(\)/);
      expect(src).toMatch(/spaceForViewer\(c, id\)/);
    });
  }

  it("the pin gates read, then the contribute ladder", () => {
    const src = code("src/app/api/spaces/[id]/default-view/route.ts");
    expect(src.indexOf("spaceForViewer(c, id)")).toBeLessThan(src.indexOf("canContributeSpaceFor(c, space.id)"));
  });

  it("Bird's eye answers list_not_found for any List outside the readable set", () => {
    const src = code("src/app/api/spaces/[id]/birdseye/route.ts");
    expect(src).toMatch(/readableListsInSpace\(space\.id, c, \{ includeSettings: true \}\)/);
    expect(src).toMatch(/if \(!list\) return answer\(\{ error: "list_not_found" \}, 404\);/);
    expect(src).toMatch(/"Cache-Control": "no-store"/);
  });
});

describe("every Space List listing goes through the one predicate", () => {
  it("GET /api/boards?all=1, ?spaceId= and ?folderId= answer readable Lists only, each over one world", () => {
    const src = code("src/app/api/boards/route.ts");
    const get = between(src, "export async function GET", "export async function POST");
    expect(get.match(/nodeRoleMap\(nodeCtx, "list", rows\.map\(\(b\) => b\.id\)\)/g)?.length).toBe(3);
    expect(get.match(/\.filter\(\(b\) => roleAtLeast\(roles\.get\(b\.id\) \?\? "none", "VIEW"\)\)/g)?.length).toBe(3);
    expect(get).not.toMatch(/readableListsInSpace\(/);
  });

  it("GET /api/boards?readable=1 decides every candidate over one world, the path door included", () => {
    const src = code("src/app/api/boards/route.ts");
    const fn = between(src, "async function readableLists(", "\nconst isoDate");
    expect(fn).toMatch(/listSpacesForUser\(c\.userId, c\.organizationId, \{ accessLevel: c\.accessLevel, paths: true \}\)/);
    expect(fn).toMatch(/const readSpaces = spaces\.filter\(\(s\) => s\.access !== "path"\);/);
    expect(fn).toMatch(/const roles = await nodeRoleMap\(/);
    expect(fn).toMatch(/roleAtLeast\(roles\.get\(b\.id\) \?\? "none", writable \? "EDIT" : "VIEW"\)/);
    expect(fn).not.toMatch(/getBoardForReader\(|canContributeBoard\(/);
  });

  it("the Space page reads its Lists once, before the header, and no longer from the Space include", () => {
    const page = code("src/app/(dashboard)/spaces/[slug]/page.tsx");
    expect(page).toMatch(/const \{ lists: readableLists, folderCount \} = await readableListsInSpace\(/);
    expect(page).not.toMatch(/space\.boards/);
    expect(page).not.toMatch(/allBoards/);
    expect(page).not.toMatch(/listStatusRows/);
    expect(page.indexOf("readableListsInSpace(")).toBeLessThan(page.indexOf("const header = ("));
    expect(page).toMatch(/\$\{readableLists\.length\} lists · \$\{folderCount\} folders/);
    expect(page).toMatch(/\{ includeSchema: view === "calendar" \|\| view === "gantt", tree \},/);
  });

  it("returns Bird's eye before any other tab's query runs", () => {
    const page = code("src/app/(dashboard)/spaces/[slug]/page.tsx");
    const birdseye = page.indexOf('if (view === "birdseye")');
    expect(birdseye).toBeGreaterThan(-1);
    for (const later of ["prisma.doc.findMany", "prisma.item.findMany", "prisma.item.groupBy", "getEffectivePreferences("]) {
      expect({ later, after: page.indexOf(later) > birdseye }).toEqual({ later, after: true });
    }
  });
});

describe("the Space pin's Unpin names the view it unpins", () => {
  const route = code("src/app/api/spaces/[id]/default-view/route.ts");
  const del = between(route, "export async function DELETE", "\nexport ");
  const menu = code("src/app/(dashboard)/spaces/[slug]/space-tab-menu.tsx");

  it("clears the pin only when the locked row still holds that view, else answers 409", () => {
    expect(del).toMatch(/if \(!isSpaceViewKey\(view\)\) return answer\(/);
    expect(del).toMatch(/readSpaceDefaultView\(settings\) === view\s*\?\s*\{ patch: \{ defaultView: null \}/);
    expect(del).toMatch(/: \{ patch: null, result: "stale" as const \}/);
    expect(del).toMatch(/r\.result === "stale"/);
    expect(del).toMatch(/409/);
    expect(del).not.toMatch(/\(\) => \(\{ patch: \{ defaultView: null \}/);
  });

  it("sends the view key from the menu: the tab's own, or the hidden pin's on Overview", () => {
    expect(menu).toMatch(/method: "DELETE",[\s\S]{0,120}body: JSON\.stringify\(\{ view: row === "unpin" \? viewKey : \(pinnedKey \?\? viewKey\) \}\)/);
  });
});

describe("the Work sidebar tree names only the Lists this viewer can read", () => {
  const route = code("src/app/api/spaces/[id]/children/route.ts");

  it("is the resolver's tree and nothing else: no query, no legacy signal, no second predicate", () => {
    expect(route).toMatch(/const tree = await spaceTree\(ctx, id\);/);
    expect(route).toMatch(/await nodeCtxFromSession\(\)/);
    expect(route).not.toMatch(/prisma\./);
    expect(route).not.toMatch(/accessLevel/);
    expect(route).not.toMatch(/readableListsInSpace|folderVisibleTo|folderAccessForSpace/);
  });

  it("fails closed: no tree is a 404, a failed read is a 500 with no rows", () => {
    expect(route).toMatch(/if \(!tree\) return NextResponse\.json\(\{ error: "Not found" \}, \{ status: 404 \}\);/);
    expect(route).toMatch(/status: 500/);
  });
});
