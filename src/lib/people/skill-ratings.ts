// A manager's rating of a person's skill belongs to the workspace it was
// given in (docs/plans/workspace-status.md, the final review, security M2).
//
// UserSkill has no workspace: a person's skills are one list on their
// account, read by every workspace they work in. Its old managerRating was
// one number for the account, so a rating A's manager gave followed the
// person into B (a D3 move, a D6 restore, the switcher), where B's managers,
// People team and Admins read it on the record and in the Skills page's Gap
// and Expert chips, and B's manager overwrote it, so A's assessment was
// gone if they came back.
//
// Now UserSkill.managerRatings holds one rating per workspace, keyed by the
// workspace's id ({ "<workspace id>": rating }): every read shows the acting
// workspace's own key only, and every write sets only that key, never
// another's. The old managerRating column stays as it was at the deploy
// (nothing deleted; the SQL file's step three keyed each value by the
// person's home workspace, the fixes review L3) and is no longer read for
// display. Self ratings stay the person's own, one per skill.
//
// A RATING ON THE OLD 10-POINT SCALE READS AS IT IS (the fixes review M1).
// The profile once rated out of 10, and skills-aggregate.ts keeps such a
// legacy rating "shown on its own scale, never rewritten" (ratingLabel
// prints a 7 as "7/10"). Step three copied each old value as it was, so a
// read takes any whole number from 1 to 10; a write stays 1 to 5 (the PATCH
// route's isRating), so nothing new is ever given on the old scale.
//
// A leaf, pure: the routes read and write the column.

import type { Prisma } from "@/generated/prisma";

/** A stored rating: a whole number from 1 to 10 (1 to 5, or a legacy value on the old 10-point scale). */
function isStoredRating(v: unknown): v is number {
  return typeof v === "number" && Number.isInteger(v) && v >= 1 && v <= 10;
}

/** The ratings as a plain object, whatever the column holds (a stored null or a non-object reads as none). */
function asObject(ratings: Prisma.JsonValue | null | undefined): Record<string, Prisma.JsonValue> {
  return ratings && typeof ratings === "object" && !Array.isArray(ratings) ? (ratings as Record<string, Prisma.JsonValue>) : {};
}

/** This workspace's manager rating of the skill, or null when it gave none. */
export function ratingHere(ratings: Prisma.JsonValue | null | undefined, organizationId: string): number | null {
  const v = asObject(ratings)[organizationId];
  return isStoredRating(v) ? v : null;
}

/**
 * The ratings with this workspace's key set to `value`, or taken out when it
 * is null; every other workspace's key kept exactly as it is.
 */
export function withRatingHere(ratings: Prisma.JsonValue | null | undefined, organizationId: string, value: number | null): Prisma.InputJsonObject {
  const next: Record<string, Prisma.JsonValue> = { ...asObject(ratings) };
  if (value === null) delete next[organizationId];
  else next[organizationId] = value;
  return next as Prisma.InputJsonObject;
}

/** The refusal of a skill's removal by anyone but the person while another workspace rated it (403 rated_elsewhere). */
export const RATED_ELSEWHERE_REFUSAL = "This skill has a rating from another workspace, so only they can remove it.";

/**
 * Whether a workspace other than this one holds a manager rating of the
 * skill (the fixes review L2): removing the row would take that rating with
 * it, so only the person removes such a skill.
 */
export function ratedElsewhere(ratings: Prisma.JsonValue | null | undefined, organizationId: string): boolean {
  return Object.entries(asObject(ratings)).some(([key, v]) => key !== organizationId && isStoredRating(v));
}
