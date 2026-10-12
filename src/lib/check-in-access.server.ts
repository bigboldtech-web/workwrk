import "server-only";

// Who may read a person's daily check-ins (CheckIn: mood, what went well,
// challenges, tomorrow's plan), and what one may hold. Docs-found fixes
// batch 5: GET /api/check-ins listed the 50 newest check-ins of ANY member of
// the workspace to anyone signed in, and `?userId=` picked any person, so a
// colleague could read a peer's low-mood days and the challenges they wrote.
// Mood is people data: the docs promise a peer "no mood check-ins"
// (docs/product/using/my-profile.mdx).
//
// THE RULE is the people-data ladder every people route asks
// (src/lib/people/person-access.server.ts relationTo): your own always; anyone
// else's only where you read their people data in this workspace (an Owner or
// Admin, the People team, the org-wide levels, or their manager chain, solid
// or dotted; never an Agent, whose chain is empty; never a Guest).
//
// IN THIS WORKSPACE is the level a person holds here (acting-workspace.ts
// levelHeldIn): anchored here, or a membership here. Never User.organizationId
// alone, which is only the last workspace they switched to on any device: an
// employee who once opened a partner workspace would vanish from their own
// company's reads, and land in the partner's. A check-in names no workspace
// (the table has no column for it), so someone who belongs to two
// workspaces has one set of check-ins, read in each by that workspace's own
// people-data readers of them (Found, not fixed, in
// docs/plans/docs-found-fixes.md batch 5).
//
// Server-only (prisma, the session's people context).

import type { Prisma } from "@/generated/prisma";
import { levelHeldIn } from "@/lib/access/acting-workspace";
import { readsPeopleDataOf, type PeopleCtx } from "@/lib/people/person-access.server";

/** People who hold a level in this workspace: anchored here, or a member here. */
export function holdsALevelIn(organizationId: string): Prisma.UserWhereInput {
  return { OR: [{ organizationId }, { organizationMemberships: { some: { organizationId } } }] };
}

/**
 * Reads everyone's people data here: what relationTo answers for anyone but
 * the viewer when they are an Owner or Admin, on the People team or at an
 * org-wide level. A Guest reads only their own.
 */
function readsEveryone(ctx: PeopleCtx): boolean {
  return ctx.orgRole !== "GUEST" && (ctx.isAdmin || ctx.peopleTeam || ctx.orgWide);
}

/**
 * The check-ins this viewer may list: their own, and those of the people
 * here whose people data they read (THE RULE, above), as one where. The same
 * ladder as readsPeopleDataOf, so a list never holds a row a single read of
 * that person would refuse (check-in-access.test.ts holds the two equal).
 */
export function readableCheckInsWhere(ctx: PeopleCtx): Prisma.CheckInWhereInput {
  const own: Prisma.CheckInWhereInput = { userId: ctx.userId };
  if (ctx.orgRole === "GUEST") return own;
  if (readsEveryone(ctx)) return { OR: [own, { user: holdsALevelIn(ctx.organizationId) }] };
  const chain = [...ctx.chain].filter((id) => id !== ctx.userId);
  return chain.length === 0 ? own : { OR: [own, { userId: { in: chain }, user: holdsALevelIn(ctx.organizationId) }] };
}

/** May this viewer read this one person's check-ins? Their own, or people data they read of someone who holds a level here. */
export async function mayReadCheckInsOf(ctx: PeopleCtx, subjectId: string): Promise<boolean> {
  if (subjectId === ctx.userId) return true;
  if (!readsPeopleDataOf(ctx, subjectId)) return false;
  return (await levelHeldIn(subjectId, ctx.organizationId)) != null;
}

/** The longest a check-in's text may be, per field. */
export const CHECK_IN_TEXT_MAX = 2000;
const TEXT_FIELDS = ["wentWell", "challenges", "tomorrow"] as const;

export type CheckInInput = { mood: number; wentWell: string | null; challenges: string | null; tomorrow: string | null };

/**
 * A check-in as POST /api/check-ins may write it, or the 400's sentence.
 * The mood is a whole number from 1 to 5 (it used to take "3", or 2.5, and
 * fail inside the write with a bare 500); each text is text or nothing, at
 * most CHECK_IN_TEXT_MAX characters. Nothing else in the body is read: the
 * writer is always the signed-in person.
 */
export function parseCheckIn(body: unknown): { ok: true; value: CheckInInput } | { ok: false; error: string } {
  if (!body || typeof body !== "object" || Array.isArray(body)) return { ok: false, error: "Send the check-in as a JSON object." };
  const b = body as Record<string, unknown>;
  if (typeof b.mood !== "number" || !Number.isInteger(b.mood) || b.mood < 1 || b.mood > 5) {
    return { ok: false, error: "Mood must be a whole number from 1 to 5" };
  }
  const value: CheckInInput = { mood: b.mood, wentWell: null, challenges: null, tomorrow: null };
  for (const field of TEXT_FIELDS) {
    const raw = b[field];
    if (raw === undefined || raw === null) continue;
    if (typeof raw !== "string") return { ok: false, error: `${field} must be text` };
    if (raw.length > CHECK_IN_TEXT_MAX) return { ok: false, error: `${field} can be at most ${CHECK_IN_TEXT_MAX} characters` };
    value[field] = raw;
  }
  return { ok: true, value };
}
