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
//   5. it reads home rows only, and the day linked rows go live on the List
//      canvas this fails until the union is added here.

import { describe, expect, it } from "vitest";
import { existsSync, readFileSync } from "node:fs";
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

describe("home rows only, a recorded decision (2026-09-26)", () => {
  it("reads home rows only while linked rows are live on the List canvas, until the union ships on its own", () => {
    // Decided on the worst case. Linked rows went live with Phase 5b's
    // screens, and Bird's eye still draws each List's own tasks only. The
    // worst case of that: a task linked in from ANOTHER Space's List is
    // missing from this column, while its home column and every List view
    // still show it. The worst case of a rushed union across the loader's
    // keyset paging, counts and focus buckets: a card moved here writes a
    // wrong status onto another List's task, or counts what a viewer
    // cannot read. So the union is its own reviewed change, and this test
    // fails if part of one lands here by accident.
    expect(LOADER).not.toMatch(/ItemListLink/);
  });
});
