// A source contract for src/lib/work/birdseye-server.ts, the loader behind
// GET /api/spaces/[id]/birdseye.
//
// The loader cannot run here: it needs Prisma and a database, which the node
// unit environment deliberately does not carry. So this reads the file and
// pins the properties a future edit could silently undo:
//
//   1. it reads NO access: the route hands it readable Lists, and a second,
//      different gate inside it would be how two surfaces disagree;
//   2. every statement is scoped to the organization and takes its ids as ONE
//      array parameter (= ANY), never IN (Prisma.join(...)), which rendered
//      "?,?" inside the Next server bundle (src/lib/doc-lock.ts);
//   3. it pages with LIMIT page+1, and focus mode's partition and its column
//      pages use the SAME bucket fragment, so a column's later pages return
//      exactly the rows its total counts;
//   4. the subtask count is the subtasks route's own scope;
//   5. linked rows (Phase 5b) reach it only as cards handed in, built from
//      the List's own projection (listLinkedRootRows), so Bird's eye and the
//      Board can never decide a linked row differently, and the loader still
//      names no link table.

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { BIRDSEYE_PAGE } from "./birdseye";

const ROOT = process.cwd();
const read = (rel: string) => readFileSync(join(ROOT, rel), "utf8");
/** Code only: the header prose names the things it must not do. */
const code = (src: string) => src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");

const LOADER = code(read("src/lib/work/birdseye-server.ts"));

function fn(name: string): string {
  const start = LOADER.indexOf(`function ${name}(`);
  expect(start, name).toBeGreaterThan(-1);
  const ends = ["\nexport ", "\nasync function ", "\nfunction "]
    .map((marker) => LOADER.indexOf(marker, start + 1))
    .filter((i) => i > -1);
  return LOADER.slice(start, ends.length ? Math.min(...ends) : undefined);
}

describe("the Bird's eye loader reads no access", () => {
  it("never calls a gate, reads the legacy signal or touches a member table", () => {
    for (const forbidden of [
      /getBoardForReader/,
      /canContributeBoard/,
      /canEditBoard/,
      /getSpaceForReader/,
      /accessLevel/,
      /isOrgAdmin/,
      /prisma\.(spaceMember|folderMember|boardMember)/,
      /legacyAllows/,
    ]) {
      expect(LOADER).not.toMatch(forbidden);
    }
  });
});

describe("every statement is org-scoped and takes its ids as one array", () => {
  it("scopes each raw statement to the organization and to live rows", () => {
    const statements = LOADER.split("prisma.$queryRaw").slice(1);
    expect(statements.length).toBeGreaterThanOrEqual(5);
    for (const s of statements) {
      const body = s.slice(0, s.indexOf("`;") + 2);
      expect(body).toMatch(/i\."organizationId" = \$\{orgId\}/);
      expect(body).toMatch(/i\."archivedAt" IS NULL/);
    }
  });

  it("uses = ANY(...::text[]) and never Prisma.join", () => {
    expect(LOADER).toMatch(/= ANY\(\$\{ids\}::text\[\]\)/);
    expect(LOADER).not.toMatch(/Prisma\.join/);
  });

  it("reads people from the viewer's own organization", () => {
    expect(fn("peopleFor")).toMatch(/organizationId: orgId/);
  });
});

describe("paging", () => {
  it("asks for one row more than a page, the signal that there is more", () => {
    expect(LOADER).toMatch(/const LIMIT = BIRDSEYE_PAGE \+ 1;/);
    expect(BIRDSEYE_PAGE).toBe(50);
    expect(LOADER.match(/LIMIT \$\{LIMIT\}/g)?.length).toBe(3);
    expect(LOADER).toMatch(/w\.rn <= \$\{LIMIT\}/);
  });

  it("orders and resumes an overview column by (column, position, id)", () => {
    const page = fn("loadListPage");
    expect(page).toMatch(/\(\$\{rankOf\(ranks\)\}, i\.position, i\.id\) > \(\$\{cursor\.rank\}::int, \$\{cursor\.position\}::float8, \$\{cursor\.id\}::text\)/);
    expect(page).toMatch(/ORDER BY "rank", i\.position, i\.id/);
    expect(fn("loadOverview")).toMatch(/ORDER BY "rank", i\.position, i\.id/);
  });

  it("partitions focus columns and pages them with the SAME bucket fragment", () => {
    const focus = fn("loadFocus");
    const focusPage = fn("loadFocusPage");
    expect(focus).toMatch(/const bucket = bucketOf\(declared, first\);/);
    expect(focus).toMatch(/\$\{bucket\} AS bucket/);
    expect(focus).toMatch(/PARTITION BY \$\{bucket\} ORDER BY i\.position, i\.id/);
    expect(focusPage).toMatch(/AND \$\{bucketOf\(declared, first\)\} = \$\{bucketValue\}::text/);
    expect(focusPage).toMatch(/\(i\.position, i\.id\) > \(\$\{cursor\.position\}::float8, \$\{cursor\.id\}::text\)/);
  });

  it("puts null and undeclared statuses in the first column, like the List's own Board", () => {
    expect(fn("bucketOf")).toMatch(/CASE WHEN \$\{declared\} @> to_jsonb\(i\.status\) THEN i\.status ELSE \$\{first\}::text END/);
    expect(fn("rankOf")).toMatch(/COALESCE\(\(\$\{ranks\} ->> i\.status\)::int, 0\)/);
  });
});

describe("counts", () => {
  it("counts subtasks exactly as GET /api/items/[id]/subtasks scopes them", () => {
    expect(fn("subtasksOf")).toMatch(/s\."parentItemId" = \$\{alias\}\.id AND s\."boardId" = \$\{alias\}\."boardId" AND s\."archivedAt" IS NULL/);
    const route = code(read("src/app/api/items/[id]/subtasks/route.ts"));
    expect(route).toMatch(/parentItemId: id/);
    expect(route).toMatch(/boardId: gate\.item\.boardId/);
    expect(route).toMatch(/archivedAt: null/);
  });

  it("decides closed statuses in JS with the one done rule and hands SQL the values", () => {
    expect(fn("countLists")).toMatch(/closedValuesPresent\(list\.statuses/);
    expect(fn("countLists")).toMatch(/isClosedStatus\(list\.statuses, g\.status\)/);
    expect(fn("closedTest")).toMatch(/COALESCE\(\$\{closed\} @> to_jsonb\(i\.status\), false\)/);
  });

  it("keeps only top-level cards, the Board's rule 2 included", () => {
    expect(LOADER).toMatch(/i\."parentItemId" IS NULL OR NOT EXISTS \(\s*SELECT 1 FROM "Item" p WHERE p\.id = i\."parentItemId" AND p\."boardId" = i\."boardId" AND p\."archivedAt" IS NULL/);
  });

  it("escapes the search for ILIKE ... ESCAPE '!'", () => {
    expect(fn("search")).toMatch(/i\.title ILIKE \$\{likePattern\(q\)\} ESCAPE '!'/);
  });
});

describe("linked rows, through the List's own projection only (2026-10-03)", () => {
  // The union shipped as its own reviewed change, replacing the recorded
  // decision of 2026-09-26 (home rows only). Its worst cases are what these
  // pin: a card moved here writing a wrong status onto another List's task,
  // or a count including what a viewer cannot read.
  const LINKED_SERVER = code(read("src/lib/work/birdseye-linked.server.ts"));
  const LINKED = code(read("src/lib/work/birdseye-linked.ts"));
  const ROUTE = code(read("src/app/api/spaces/[id]/birdseye/route.ts"));
  const FOLDER_ROUTE = code(read("src/app/api/folders/[id]/birdseye/route.ts"));
  const ANSWER = code(read("src/lib/work/birdseye-answer.server.ts"));
  const ROWS = code(read("src/lib/board-items.ts"));

  it("keeps the loader free of the link table: it merges cards handed in", () => {
    expect(LOADER).not.toMatch(/ItemListLink|itemListLink/);
    expect(LOADER).toMatch(/export interface ExtraCard extends BirdseyeCard/);
    for (const name of ["countLists", "loadOverview", "loadListPage", "loadFocus", "loadFocusPage"]) {
      expect(fn(name), name).toMatch(/extra\??: /);
    }
    expect(LOADER.match(/mergeCardPage\(/g)?.length).toBe(4);
  });

  it("builds every linked card from the List's own projection and reads no access itself", () => {
    expect(LINKED_SERVER).toMatch(/listLinkedRootRows\(list\.id, viewer\)/);
    // The one direct touch of the link table is the count that skips Lists
    // with nothing linked in, behind the same missing-table guard.
    expect(LINKED_SERVER.match(/prisma\.itemListLink\./g)).toEqual(["prisma.itemListLink."]);
    expect(LINKED_SERVER).toMatch(/withListLinks\(\s*\(\) => prisma\.itemListLink\.groupBy/);
    for (const forbidden of [/getBoardForReader/, /canContributeBoard/, /canEditBoard/, /getSpaceForReader/, /isOrgAdmin/, /prisma\.item\./, /\$queryRaw/]) {
      expect(LINKED_SERVER).not.toMatch(forbidden);
      expect(LINKED).not.toMatch(forbidden);
    }
    // listLinkedRootRows is the Board's union read, roots only, projected by viewRows.
    const start = ROWS.indexOf("export async function listLinkedRootRows(");
    expect(start).toBeGreaterThan(-1);
    const body = ROWS.slice(start, ROWS.indexOf("\nexport ", start + 1));
    expect(body).toMatch(/linkedRowsForList\(board, \{ includeArchived: false \}\)/);
    expect(body).toMatch(/board\.organizationId !== viewer\.organizationId/);
    expect(body).toMatch(/viewRows\(enriched, \{ viewer, context: board, linked: info \}\)/);
  });

  it("places, drags and explains a linked card by the Board's own rules", () => {
    expect(LINKED).toMatch(/const placed = boardStatusFor\(row, list\.id, list\.statuses\)/);
    expect(LINKED).toMatch(/canDrag: linkedRowEditable\(row, list\.canContribute\) && statusPickerFor\(row, list\.id, list\.statuses\)\.editable/);
    expect(LINKED).toMatch(/position: Number\(link\.position\)/);
    expect(LINKED).toMatch(/link\.boardId !== list\.id \|\| link\.position == null/);
  });

  it("hands the loader linked cards for exactly the readable Lists it reads", () => {
    expect(ROUTE).toMatch(/const \{ lists: rows \} = await readableListsInSpace\(space\.id, c,/);
    expect(FOLDER_ROUTE).toMatch(/const \{ lists: rows \} = await readableListsInFolder\(folder, c,/);
    expect(ANSWER).toMatch(/const loaderLists: LoaderList\[\] = rows\.map\(/);
    expect(ANSWER).toMatch(/const linkedLists: LinkedList\[\] = rows\.map\(\(r\) => \(\{ id: r\.id, statuses: [^]*?canContribute: r\.canContribute \}\)\)/);
    expect(ANSWER.match(/linkedFor\(/g)?.length).toBeGreaterThanOrEqual(4);
  });

  it("writes a linked card's status in its home set, through the List it is shown in", () => {
    const hook = code(read("src/components/space-birdseye/use-birdseye.ts"));
    // A column maps to the home value the Board would write, or is refused.
    expect(hook).toMatch(/const t = homeStatusTarget\(linkedRowOf\(card\), next, statusesHere\);/);
    expect(hook).toMatch(/toast\(linkedStatusRefusal\(linkedRowOf\(card\), label, t\.reason\)/);
    expect(hook).toMatch(/homeValue = t\.status;/);
    // A home status picked from its own set lands where the Board places it.
    expect(hook).toMatch(/column = columnForHomeValue\(card, list, next\)/);
    // Either way the write names the List it is made in.
    expect(hook).toMatch(/homeValue !== null \? \{ status: homeValue, contextBoardId: card\.boardId \} : \{ status: next \}/);
    // The pill offers the home set only where the Board's pill does.
    const cardSrc = code(read("src/components/space-birdseye/birdseye-card.tsx"));
    expect(cardSrc).toMatch(/const homePicker = linkedRow \? statusPickerFor\(linkedRow, card\.boardId, list\.statuses\) : null;/);
    expect(cardSrc).toMatch(/const homePick = !!homePicker\?\.editable;/);
  });
});
