// Review round 1 of Phase 4: a person's teammate rows (the sites a teammate
// opened for them, that it sent their mail or changed their calendar, their
// Google connection) are read only by Owners and Admins and by that person.
// Every reader that hands workspace activity to someone else, a feed or Ask
// AI's context, leaves them out; before, Ask AI's context and the team
// members' work read them for any asker.

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const READERS = ["src/app/api/ai/route.ts", "src/app/api/team/members-work/route.ts", "src/app/api/dashboard/route.ts"];

/**
 * Review round 2 of Phase 4: the export reads a person's own activity as
 * Activity's Just me does (myActivityWhere): the rows they wrote, and the
 * personal rows about them whoever wrote them. Before, it read every row the
 * person was the actor of. Review round 3 added the personal rows the person
 * wrote about someone else, trimmed to the writer's part, to the same read
 * and cap (exportActivityWhere). Review round 4: those shared the newest
 * 10,000 with the person's own, so an Admin's Disconnect everyone could push
 * every one of their own rows out; activityLogs is read by myActivityWhere
 * again, and the rows about others are a second list read by
 * exportWrittenAboutOthersWhere, each with its own cap and count.
 */
const EXPORT = "src/app/api/me/export/route.ts";

/** Each activity read of a file: its operation, and the text from its call on. */
const activityReads = (src: string) =>
  [...src.matchAll(/activityLog\.(findMany|findFirst|groupBy|count|aggregate)\(/g)].map((m) => ({ op: m[1], from: src.slice((m.index ?? 0) + m[0].length) }));

/** The where builder an activity read opens with, called on the person's id, or null for any other where clause. */
const builderOf = (from: string) => /^\{\s*where:\s*(\w+)\(userId\)/.exec(from)?.[1] ?? null;

describe("personal teammate activity rows stay out of other people's readers", () => {
  for (const path of READERS) {
    it(`${path} leaves PERSONAL_TEAMMATE_ACTIVITY_TYPES out of every activity read`, () => {
      const src = readFileSync(path, "utf8");
      const reads = activityReads(src);
      expect(reads.length).toBeGreaterThan(0);
      for (const r of reads) expect(r.from.slice(0, 400)).toContain("PERSONAL_TEAMMATE_ACTIVITY_TYPES");
    });
  }

  it(`${EXPORT} reads activityLogs by myActivityWhere and activityAboutOthers by exportWrittenAboutOthersWhere, both from personal-activity.ts`, () => {
    const src = readFileSync(EXPORT, "utf8");
    const reads = activityReads(src);
    // The main list and its count by Just me's where clause; the second list and its count by the rows about others.
    expect(reads.map((r) => [r.op, builderOf(r.from)])).toEqual([
      ["findMany", "myActivityWhere"],
      ["count", "myActivityWhere"],
      ["findMany", "exportWrittenAboutOthersWhere"],
      ["count", "exportWrittenAboutOthersWhere"],
    ]);
    // Each list's own cap.
    expect(reads[0].from.slice(0, 300)).toMatch(/take: ACTIVITY_EXPORT_MAX,/);
    expect(reads[2].from.slice(0, 300)).toMatch(/take: ACTIVITY_ABOUT_OTHERS_EXPORT_MAX,/);
    expect(src).toMatch(/const ACTIVITY_EXPORT_MAX = 10_000;/);
    expect(src).toMatch(/const ACTIVITY_ABOUT_OTHERS_EXPORT_MAX = 1_000;/);
    // The builders are personal-activity.ts's own, never a copy in the route.
    for (const where of ["myActivityWhere", "exportWrittenAboutOthersWhere"]) {
      expect(src).toMatch(new RegExp(`import \\{[^}]*\\b${where}\\b[^}]*\\} from "@/lib/access/personal-activity"`));
      expect(src).not.toMatch(new RegExp(`function ${where}\\b`));
    }
    // Round 3's one read for both is gone, from the route and from personal-activity.ts.
    expect(src).not.toMatch(/exportActivityWhere/);
    expect(readFileSync("src/lib/access/personal-activity.ts", "utf8")).not.toMatch(/exportActivityWhere/);
  });
});
