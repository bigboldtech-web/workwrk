import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

// Two promises the Schedule report dialog makes, held at the source the way
// list-links.client-contract.test.ts holds its switch: comments are stripped,
// so an explanation that names a field never passes the guard on its own.
//
//   * A recipient sees when a schedule they are on is paused. The received
//     rows carry `active`, and the dialog reads it with nextRunAt, so a paused
//     schedule never reads as one that still sends.
//   * A view's dialog names its List. Every List's default view is called
//     "List", so the view name alone read the same on every List while the
//     email subject said "List name: View name".

const SRC = join(__dirname, "..", "..");

function code(rel: string): string {
  return readFileSync(join(SRC, rel), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/.*$/gm, "$1");
}

/** The ?received=1 branch of GET /api/report-schedules. */
function receivedBranch(): string {
  const s = code("app/api/report-schedules/route.ts");
  const start = s.indexOf(`sp.get("received") === "1"`);
  const end = s.indexOf("const targetKind", start);
  expect(start).toBeGreaterThan(-1);
  return s.slice(start, end);
}

describe("received schedules show their paused state", () => {
  it("the received DTO carries active and nextRunAt", () => {
    const b = receivedBranch();
    expect(b).toMatch(/active:\s*r\.active/);
    expect(b).toMatch(/nextRunAt:\s*r\.nextRunAt/);
  });

  it("the dialog's received rows read active and nextRunAt", () => {
    const d = code("components/reports/schedule-report-dialog.tsx");
    const start = d.indexOf("interface ReceivedRow");
    const row = d.slice(start, d.indexOf("\n}", start));
    expect(row).toMatch(/active:\s*boolean/);
    expect(row).toMatch(/nextRunAt:\s*string \| null/);
    const list = d.slice(d.indexOf("received.map("), d.indexOf("Stop receiving"));
    expect(list).toMatch(/r\.active && r\.nextRunAt/);
    expect(list).toMatch(/Paused/);
  });
});

describe("a view's Schedule report dialog names its List", () => {
  it("the List page hands the List's name to the view tabs", () => {
    // The BoardViewTabs element itself: the page hands board.name to other
    // children too, which says nothing about the tabs.
    const pg = code("app/(dashboard)/boards/[slug]/page.tsx");
    const start = pg.indexOf("<BoardViewTabs");
    expect(start).toBeGreaterThan(-1);
    expect(pg.slice(start, pg.indexOf("/>", start))).toMatch(/boardName=\{board\.name\}/);
  });

  it("the view tabs pass it on to each tab's menu", () => {
    expect(code("app/(dashboard)/boards/[slug]/board-view-tabs.tsx")).toMatch(/<ViewTabContextMenu[^>]*boardName=\{boardName\}/);
  });

  it("the menu names the dialog target List: View, as the email does", () => {
    const m = code("components/board-view/view-tab-menu.tsx");
    const start = m.indexOf("<ScheduleReportDialog");
    const target = m.slice(start, m.indexOf("/>", start));
    expect(target).toMatch(/name:\s*boardName \? `\$\{boardName\}: \$\{view\.name\}` : view\.name/);
  });
});

describe("the Active switch never loops on a private view", () => {
  it("a private_view_recipients refusal offers Edit, not a Try again that is refused forever", () => {
    const s = code("components/reports/schedule-report-dialog.tsx");
    const start = s.indexOf("const setActive = async");
    const end = s.indexOf("const remove = async", start);
    expect(start).toBeGreaterThan(-1);
    const fn = s.slice(start, end);
    const branch = fn.slice(fn.indexOf(`"private_view_recipients"`), fn.lastIndexOf("Try again"));
    expect(branch).toMatch(/label:\s*"Edit",\s*onClick:\s*\(\)\s*=>\s*startEdit\(s\)/);
    expect(branch).toMatch(/return;/);
  });
});
