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
 * Review round 2 of Phase 4: the readers that hand a person their own
 * activity, which read it as Activity's Just me does (myActivityWhere): the
 * rows they wrote, but never a personal row about someone else, and the
 * personal rows about them whoever wrote them. Before, the export read
 * every row the person was the actor of.
 */
const OWN_READERS = ["src/app/api/me/export/route.ts"];

/** Each activity read of a file, from its call on. */
const activityReads = (src: string) => src.split(/activityLog\.(?:findMany|findFirst|groupBy|count|aggregate)\(/).slice(1);

describe("personal teammate activity rows stay out of other people's readers", () => {
  for (const path of READERS) {
    it(`${path} leaves PERSONAL_TEAMMATE_ACTIVITY_TYPES out of every activity read`, () => {
      const src = readFileSync(path, "utf8");
      const reads = activityReads(src);
      expect(reads.length).toBeGreaterThan(0);
      for (const r of reads) expect(r.slice(0, 400)).toContain("PERSONAL_TEAMMATE_ACTIVITY_TYPES");
    });
  }

  for (const path of OWN_READERS) {
    it(`${path} reads a person's own activity by myActivityWhere, every read of it`, () => {
      const src = readFileSync(path, "utf8");
      const reads = activityReads(src);
      expect(reads.length).toBeGreaterThan(0);
      for (const r of reads) expect(r.slice(0, 200)).toMatch(/^\{\s*where:\s*myActivityWhere\(userId\)/);
    });
  }
});
