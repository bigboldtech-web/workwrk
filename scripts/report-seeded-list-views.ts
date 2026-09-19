// report-seeded-list-views — which saved views did `ensureCoreListViews` make
// that nobody ever touched?
//
// Spec: docs/plans/ui-refresh/spec-spaces-lists.md section 4 step 6:
// "`ensureCoreListViews` deleted with a dry-run migration script that reports
// (and, after approval, removes) views it created that were never renamed,
// reordered, configured or opened (`View.config` empty and `View.name` in
// {Board, Calendar, Gantt} and `updatedAt` equal to `createdAt`)".
//
// WHY IT MATTERS. `ensureCoreListViews` (src/lib/board.ts) runs on EVERY render
// of `/boards/[slug]` and `/my-work/personal`, and force-seeds a Board, a
// Calendar and a Gantt view onto any task List that has a TABLE view. Every
// List therefore carries four tabs whether or not anyone wanted them, which is
// the thing the view-type switcher replaces (audit spaces-boards Medium #20).
//
// THIS SCRIPT NEVER WRITES IN THIS RELEASE. It is a report, full stop: `--write`
// is refused with an explanation, because the views it would remove are the
// only way a person currently reaches the Board, Calendar and Gantt renderers
// on a List, and the `ViewTypeSwitcher` that replaces them has not shipped.
// Removing them first would take four destinations away from every List, which
// is precisely the silent removal the "nothing disappears" rule forbids. When
// the switcher lands, the refusal comes out and the rules below stay.
//
// THE RULES, deliberately conservative. A view is "untouched" only when ALL of:
//   * its name is exactly "Board", "Calendar" or "Gantt" (the three the helper
//     seeds; a renamed view is somebody's);
//   * its `config` is empty (`{}` or null): any filter, sort, group, column
//     width or date-field choice means a person configured it;
//   * `updatedAt` equals `createdAt` to the second: any later write at all,
//     including a reorder or a default flip, means it was handled;
//   * it is not the List's default view and not its only view.
// Anything that fails one rule is reported under `kept` with the reason, so the
// founder can read what was spared as easily as what was found.
//
//   npx tsx scripts/report-seeded-list-views.ts --report /tmp/seeded-views.json

import { scriptPrisma, databaseLabel } from "./lib/script-prisma";

const SEEDED_NAMES = new Set(["Board", "Calendar", "Gantt"]);

interface ViewRow {
  id: string;
  boardId: string;
  name: string;
  isDefault: boolean;
  config: unknown;
  createdAt: Date;
  updatedAt: Date;
}

interface Candidate {
  viewId: string;
  viewName: string;
  boardId: string;
  boardName: string;
  spaceId: string | null;
  createdAt: string;
}

interface Kept {
  viewId: string;
  viewName: string;
  boardName: string;
  reason: string;
}

interface OrgReport {
  organizationId: string;
  organizationName: string;
  listsScanned: number;
  viewsScanned: number;
  untouched: Candidate[];
  kept: Kept[];
}

function configIsEmpty(config: unknown): boolean {
  if (config === null || config === undefined) return true;
  if (typeof config !== "object") return false;
  return Object.keys(config as Record<string, unknown>).length === 0;
}

/** Equal to the second: Postgres stores millis, and a no-op touch can differ. */
function neverUpdated(row: ViewRow): boolean {
  return Math.abs(row.updatedAt.getTime() - row.createdAt.getTime()) < 1000;
}

async function main() {
  const args = process.argv.slice(2);
  if (args.includes("--write")) {
    console.error(
      [
        "Refusing to write.",
        "",
        "This script is a REPORT in this release. The views it lists are the only",
        "way anyone currently reaches the Board, Calendar and Gantt renderers on a",
        "List: the view-type switcher that replaces them has not shipped yet, so",
        "deleting them would remove four destinations from every List with no",
        "replacement. Run it without --write, read the report, and keep it for the",
        "release that ships the switcher.",
      ].join("\n"),
    );
    process.exit(2);
  }
  const reportIdx = args.indexOf("--report");
  const reportPath = reportIdx >= 0 ? args[reportIdx + 1] : null;

  const prisma = scriptPrisma();
  console.log(`Database: ${databaseLabel()}`);
  console.log("Mode: REPORT ONLY (this script never writes)\n");

  const orgs = await prisma.organization.findMany({ select: { id: true, name: true } });
  const reports: OrgReport[] = [];

  for (const org of orgs) {
    const lists = await prisma.board.findMany({
      where: { organizationId: org.id, archivedAt: null },
      select: { id: true, name: true, spaceId: true },
    });
    if (lists.length === 0) continue;

    const views = (await prisma.view.findMany({
      where: { boardId: { in: lists.map((l) => l.id) } },
      select: { id: true, boardId: true, name: true, isDefault: true, config: true, createdAt: true, updatedAt: true },
      orderBy: [{ boardId: "asc" }, { displayOrder: "asc" }],
    })) as ViewRow[];

    const byBoard = new Map<string, ViewRow[]>();
    for (const v of views) {
      const arr = byBoard.get(v.boardId) ?? [];
      arr.push(v);
      byBoard.set(v.boardId, arr);
    }

    const untouched: Candidate[] = [];
    const kept: Kept[] = [];

    for (const list of lists) {
      const own = byBoard.get(list.id) ?? [];
      for (const v of own) {
        const reasons: string[] = [];
        if (!SEEDED_NAMES.has(v.name)) reasons.push(`renamed or never seeded ("${v.name}")`);
        if (!configIsEmpty(v.config)) reasons.push("has a saved configuration");
        if (!neverUpdated(v)) reasons.push("was updated after it was created");
        if (v.isDefault) reasons.push("is this List's default view");
        if (own.length <= 1) reasons.push("is this List's only view");

        if (reasons.length === 0) {
          untouched.push({
            viewId: v.id,
            viewName: v.name,
            boardId: list.id,
            boardName: list.name,
            spaceId: list.spaceId,
            createdAt: v.createdAt.toISOString(),
          });
        } else {
          kept.push({ viewId: v.id, viewName: v.name, boardName: list.name, reason: reasons.join("; ") });
        }
      }
    }

    reports.push({
      organizationId: org.id,
      organizationName: org.name,
      listsScanned: lists.length,
      viewsScanned: views.length,
      untouched,
      kept,
    });

    console.log(`— ${org.name} (${org.id})`);
    console.log(`  lists ${lists.length} · views ${views.length}`);
    console.log(`  untouched seeded views: ${untouched.length}`);
    console.log(`  kept: ${kept.length}`);
    for (const c of untouched.slice(0, 10)) {
      console.log(`    · "${c.viewName}" on "${c.boardName}" (${c.viewId})`);
    }
    if (untouched.length > 10) console.log(`    · … and ${untouched.length - 10} more`);
    console.log("");
  }

  const totals = reports.reduce(
    (acc, r) => ({
      lists: acc.lists + r.listsScanned,
      views: acc.views + r.viewsScanned,
      untouched: acc.untouched + r.untouched.length,
    }),
    { lists: 0, views: 0, untouched: 0 },
  );
  console.log(`TOTAL · ${totals.lists} lists · ${totals.views} views · ${totals.untouched} untouched seeded views`);

  if (reportPath) {
    const { writeFileSync } = await import("node:fs");
    writeFileSync(
      reportPath,
      JSON.stringify(
        { generatedAt: new Date().toISOString(), database: databaseLabel(), mode: "report-only", totals, orgs: reports },
        null,
        2,
      ),
    );
    console.log(`\nReport written to ${reportPath}`);
  }

  await prisma.$disconnect();
}

main().catch(async (err) => {
  console.error(err);
  process.exit(1);
});
