// Source contracts for the Space page's launch fixes. The page is a server
// component over Prisma and next-auth, so it cannot run here; this reads the
// file (comments stripped) and pins the wiring a later edit could quietly
// undo. The reads themselves are tested in space-tasks.test.ts and in the
// export route's own test.

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const code = (rel: string) =>
  readFileSync(join(process.cwd(), rel), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/\{\s*\}/g, "{}")
    .replace(/(^|[^:])\/\/.*$/gm, "$1");

const PAGE = code("src/app/(dashboard)/spaces/[slug]/page.tsx");

describe("the Space page's Calendar and Gantt", () => {
  it("read through readSpaceDatedTasks, one call each, and never the old single capped read", () => {
    expect(PAGE.match(/await readSpaceDatedTasks\(/g)).toHaveLength(2);
    expect(PAGE).not.toMatch(/take: 600/);
    expect(PAGE).toContain('cutNotice={calendarRead ? datedCutNotice(calendarRead, "month") : null}');
    expect(PAGE).toContain('cutNotice={ganttRead ? datedCutNotice(ganttRead, "window") : null}');
  });
});

describe("the Space page's List, Board and Team tabs", () => {
  it("read one row past the cap, count the total when cut, and never guess a cut from the row count", () => {
    expect(PAGE).toContain("take: SPACE_TASKS_CAP + 1,");
    expect(PAGE).toContain("const crossTotal = crossCut ? await prisma.item.count({ where: crossWhere }) : crossBoardItems.length;");
    expect(PAGE).not.toMatch(/items\.length === 200/);
    expect(PAGE).not.toMatch(/item\{items\.length === 1 \? "" : "s"\}/);
    expect(PAGE).toContain("{spaceTasksHeading(items.length, total, filterActive)}");
    for (const section of ["SpaceListSection", "SpaceBoardSection", "SpaceTeamSection"]) {
      expect(PAGE).toMatch(new RegExp(`<${section}\\s+items=\\{crossBoardItems\\}\\s+total=\\{crossTotal\\}\\s+cutNotice=\\{crossCutNotice\\}`));
    }
    expect(PAGE).toContain("{spaceTasksHeading(items.length, total, false)} · read-only");
    expect(PAGE).toContain("{spaceTasksCount(items.length, total)} · per-person workload");
  });

  it("export every matching task from the server, not the rows on the page", () => {
    expect(PAGE).toContain("{canExport ? <ListCsvExport href={exportHref} count={total} /> : null}");
    expect(PAGE).toContain("exportHref={spaceTasksExportHref(space.id, listSort, { statuses: listStatusFilter, owners: listOwnerFilter, due: listDue })}");
    const button = code("src/components/board-view/list-csv-export.tsx");
    expect(button).not.toMatch(/new Blob/);
    expect(button).toContain("<a href={href} download");
  });
});

describe("the Space Overview", () => {
  it("the Lists card counts done by each List's own statuses, as the Folder page does", () => {
    expect(PAGE).not.toMatch(/doneStatusKeys/);
    expect(PAGE).not.toMatch(/concat\(\["DONE", "done"\]\)/);
    expect(PAGE).toContain('prisma.item.groupBy({ by: ["boardId", "status"], where: { boardId: { in: boardIds }, archivedAt: null }, _count: { _all: true } })');
    expect(PAGE).toContain("(home, status) => isDoneStatus(homeSets.get(home) ?? getBoardStatuses(null), status),");
    expect(PAGE).toContain("const homeSets = new Map(readableLists.map((b) => [b.id, getBoardStatuses(b)] as const));");
  });

  it("the Docs card no longer repeats the doc's own name as its place", () => {
    expect(PAGE).not.toContain("in {d.title}");
    expect(PAGE).toContain("updated {timeAgo(d.updatedAt)}");
  });
});

describe("the Space wizard", () => {
  it("calls the containers Lists", () => {
    const step2 = code("src/components/layout/os/space-wizard-step2.tsx");
    expect(step2).not.toContain("every Board inside this Space");
    expect(step2).toContain("Pick which views appear in every List inside this Space.");
  });
});
