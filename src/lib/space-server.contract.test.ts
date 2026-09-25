// Source contracts for the Space server code Bird's eye added or changed:
// the ONE readable-List predicate, the ONE Space.settings writer, and the
// routes and page that must go through them.
//
// None of it can run here (Prisma, next-auth, a database), so this reads the
// files and pins what a later edit could quietly undo:
//
//   * readableListsInSpace loads its facts in four org-scoped reads, reads the
//     member tables only through relation includes, skips the folder-grant
//     read for org admins, and decides through decideSpaceLists;
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

  it("loads its facts in four parallel, org-scoped reads", () => {
    expect(body).toMatch(/await Promise\.all\(\[/);
    expect(body).toMatch(/prisma\.space\.findFirst\(\{\s*where: \{ id: spaceId, organizationId: viewer\.organizationId \}/);
    expect(body).toMatch(/prisma\.folder\.findMany\(\{\s*where: \{ spaceId, organizationId: viewer\.organizationId, \.\.\.live \}/);
    expect(body).toMatch(/prisma\.board\.findMany\(\{\s*where: \{ spaceId, organizationId: viewer\.organizationId, \.\.\.live \}/);
    expect(body).toMatch(/orderBy: \[\{ position: "asc" \}, \{ id: "asc" \}\]/);
    expect(body).toMatch(/orderBy: \[\{ name: "asc" \}, \{ id: "asc" \}\]/);
  });

  it("reads member rows only through relation includes", () => {
    expect(body).not.toMatch(/prisma\.(spaceMember|folderMember|boardMember)/);
    expect(body.match(/members: \{ where: \{ userId: viewer\.userId \}, select: \{ role: true \} \}/g)?.length).toBe(2);
  });

  it("skips the folder-grant read for an org admin", () => {
    expect(body).toMatch(/isOrgAdminAccessLevel\(viewer\.accessLevel\) \? Promise\.resolve\(new Set<string>\(\)\) : accessibleFolderIds\(viewer\.userId\)/);
  });

  it("decides through the pure predicate and answers nothing for a missing Space", () => {
    expect(body).toMatch(/if \(!space\) return \{ lists: \[\], folderCount: 0 \};/);
    expect(body).toMatch(/decideSpaceLists\(viewer, \{/);
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
  it("GET /api/boards?spaceId= and ?folderId= answer readable Lists only", () => {
    const src = code("src/app/api/boards/route.ts");
    const get = between(src, "export async function GET", "export async function POST");
    expect(get.match(/readableListsInSpace\(/g)?.length).toBe(2);
    expect(get).toMatch(/\(await listBoardsInSpace\(spaceId, \{ includeArchived \}\)\)\.filter\(\(b\) => readable\.has\(b\.id\)\)/);
    expect(get).toMatch(/\.filter\(\(b\) => readable\.has\(b\.id\)\)/);
  });

  it("the Space page reads its Lists once, before the header, and no longer from the Space include", () => {
    const page = code("src/app/(dashboard)/spaces/[slug]/page.tsx");
    expect(page).toMatch(/const \{ lists: readableLists, folderCount \} = await readableListsInSpace\(/);
    expect(page).not.toMatch(/space\.boards/);
    expect(page).not.toMatch(/allBoards/);
    expect(page).not.toMatch(/listStatusRows/);
    expect(page.indexOf("readableListsInSpace(")).toBeLessThan(page.indexOf("const header = ("));
    expect(page).toMatch(/\$\{readableLists\.length\} lists · \$\{folderCount\} folders/);
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

  it("filters the root Lists and every folder's Lists through readableListsInSpace", () => {
    expect(route).toMatch(/readableListsInSpace\(id, \{/);
    expect(route).toMatch(/rootBoardsR\.value : \[\]\)\.filter\(readable\)/);
    expect(route).toMatch(/boards: n\.boards\.filter\(readable\)\.map\(/);
    expect(route).toMatch(/_count: \{ \.\.\.n\._count, boards: n\.boards\.filter\(readable\)\.length \}/);
  });

  it("fails closed: a failed readable read shows no Lists", () => {
    expect(route).toMatch(/return new Set<string>\(\);/);
  });
});
