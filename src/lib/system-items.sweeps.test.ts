// Every sweep over a person's or a workspace's tasks leaves the product's own
// Items out (src/lib/system-items.ts NOT_SYSTEM_ITEMS). Docs-found fixes
// batch 3: a meeting's Item on the hidden Meetings List (assignees = its
// attendees, due = when it starts, no status) read as an open task in the
// due-today and overdue runs, team workload, a person's work, the team
// calendar, analytics, the performance score's task part, Everything, Talk
// updates, an AI teammate's list_tasks, "When a task's date arrives"
// automations and search. My work, Home, the ICS feed, the calendar events,
// the field candidates, list links, dashboards and GET /api/v1/tasks already
// spread it.
//
// Read from the source, so a sweep that drops the fragment fails here. Each
// count is the number of Item reads in that file that sweep tasks.

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const read = (p: string) => readFileSync(join(process.cwd(), p), "utf8");
const spreads = (src: string) => (src.match(/\.\.\.NOT_SYSTEM_ITEMS\b/g) ?? []).length;

const SWEEPS: Array<[file: string, reads: number]> = [
  ["src/app/api/email/send-reminders/route.ts", 1], // openItemsOf, under both runs
  ["src/lib/notify-item.ts", 1], // notifyItemsDueToday (not called yet)
  ["src/app/api/team/workload/route.ts", 2],
  ["src/app/api/spaces/[id]/workload/route.ts", 1],
  ["src/app/api/team/members-work/route.ts", 1], // plus the grouped SQL below
  ["src/app/api/team/person-work/route.ts", 1],
  ["src/app/api/calendar/route.ts", 2],
  ["src/lib/analytics.ts", 1],
  ["src/services/performanceScoreService.ts", 1],
  ["src/lib/everything.ts", 2], // the rows and the facets
  ["src/lib/talk-updates-server.ts", 1], // `base`, under its three reads
  ["src/lib/agents/tools.ts", 1], // list_tasks
  ["src/lib/automation/schedule-server.ts", 1], // task.date_arrives
  ["src/app/api/search/route.ts", 1],
];

describe("task sweeps leave the product's own Items out", () => {
  for (const [file, reads] of SWEEPS) {
    it(`${file} spreads NOT_SYSTEM_ITEMS in each of its ${reads} task read(s)`, () => {
      const src = read(file);
      expect(src).toMatch(/from "@\/lib\/system-items"/);
      expect(spreads(src)).toBeGreaterThanOrEqual(reads);
    });
  }

  it("the team members' grouped SQL leaves them out too", () => {
    const src = read("src/app/api/team/members-work/route.ts");
    expect(src).toMatch(/i\."itemType" NOT IN \(\$\{Prisma\.join\(\[\.\.\.SYSTEM_ITEM_TYPES\]\)\}\)/);
  });

  it("the reminder runs also leave out the hidden Meetings List and Lists in archived places", () => {
    const src = read("src/app/api/email/send-reminders/route.ts");
    expect(src).toMatch(/sweepBoards\(allBoards, spaces, folders\)/);
  });
});
