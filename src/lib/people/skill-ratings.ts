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
// workspace's id ({ "<workspace id>": 1 to 5 }): every read shows the acting
// workspace's own key only, and every write sets only that key, never
// another's. The old managerRating column stays as it was at the deploy
// (nothing deleted; the SQL file's step three keyed each value by the
// workspace the account was anchored in then) and is no longer read for
// display. Self ratings stay the person's own, one per skill.
//
// A leaf, pure: the routes read and write the column.

import type { Prisma } from "@/generated/prisma";

/** A rating is a whole number from 1 to 5. */
function isRatingValue(v: unknown): v is number {
  return typeof v === "number" && Number.isInteger(v) && v >= 1 && v <= 5;
}

/** The ratings as a plain object, whatever the column holds (a stored null or a non-object reads as none). */
function asObject(ratings: Prisma.JsonValue | null | undefined): Record<string, Prisma.JsonValue> {
  return ratings && typeof ratings === "object" && !Array.isArray(ratings) ? (ratings as Record<string, Prisma.JsonValue>) : {};
}

/** This workspace's manager rating of the skill, or null when it gave none. */
export function ratingHere(ratings: Prisma.JsonValue | null | undefined, organizationId: string): number | null {
  const v = asObject(ratings)[organizationId];
  return isRatingValue(v) ? v : null;
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
