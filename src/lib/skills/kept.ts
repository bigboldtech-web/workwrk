// Whether any skill may be kept on this WorkwrK at all (review of
// docs/plans/ai-teammates-phase5.md step 3): the reads that show a person
// their own skills, or Owners and Admins the workspace's count and Delete
// every skill, run whenever a skill can exist, whatever skillsOffered()
// says now, so a skill is never out of reach of the people who may delete
// it (Decisions 13, 14 and 25). Where this WorkwrK does not offer teaching
// by showing, no new skill can be made (a recording needs skillsOffered()
// at its start), so one read that finds none anywhere answers "none" for a
// while and those reads are skipped: production, which never offered it,
// reads nothing for skills on a chat turn, a teammate's settings or My
// account.
//
//   offered            true, nothing read
//   not offered        one read of any skill row (by its primary key); none
//                      found: false for NONE_TTL_MS, nothing read meanwhile;
//                      one found, or a read that failed: true (the caller's
//                      own read decides)
//
// Only "none" is remembered: a skill found is read again by the caller
// every time, and the window is short, so a skill made by another process
// that offers it (a deploy turning it on) is seen within a minute.
//
// Server-only: imports prisma.

import { skillsOffered } from "@/lib/browser/config";
import { prisma } from "@/lib/prisma";

/** How long a read that found no skill anywhere is trusted. */
export const NONE_TTL_MS = 60_000;

let noneUntil = 0;

/** For the tests: forget the last "none". */
export function resetSkillsKeptForTests(): void {
  noneUntil = 0;
}

/** Whether a skill may be kept here (see the header). Never throws. */
export async function skillsMayBeKept(now: number = Date.now()): Promise<boolean> {
  if (skillsOffered()) return true;
  if (now < noneUntil) return false;
  try {
    const any = await prisma.teammateSkill.findFirst({ select: { id: true } });
    if (any) return true;
    noneUntil = now + NONE_TTL_MS;
    return false;
  } catch {
    return true;
  }
}
