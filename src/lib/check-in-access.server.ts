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
// company's reads, and land in the partner's.
//
// THE WORKSPACE A CHECK-IN BELONGS TO (docs-found fixes batch 6). A check-in
// names the workspace it was written in (CheckIn.organizationId, the session's
// workspace on POST), and a read takes only the rows of the workspace being
// read. Before, a check-in named none, so Dana, anchored in Acme with a
// membership in the client workspace Globex, wrote her Acme mood and her
// challenges with her Acme manager, and every Globex Admin, People team
// member and org-wide level read them. A row written before the column
// (null) has no workspace to read it by, and none is guessed: it is read by
// others only where its person holds a level in exactly one workspace, the
// one being read (then it can only have been written there); anyone who
// holds a level in two or more is read only by themselves. Worst case of
// that: Admins of a person's only workspace keep reading what they read
// yesterday, and a person in two workspaces has older check-ins only they
// read, which no screen shows anyway. Worst case of any guess: health-grade
// notes about one employer shown to another.
//
// Server-only (prisma, the session's people context).

import type { Prisma } from "@/generated/prisma";
import { levelHeldIn } from "@/lib/access/acting-workspace";
import { readsPeopleDataOf, type PeopleCtx } from "@/lib/people/person-access.server";

/** People who hold a level in this workspace: anchored here, or a member here. */
export function holdsALevelIn(organizationId: string): Prisma.UserWhereInput {
  return { OR: [{ organizationId }, { organizationMemberships: { some: { organizationId } } }] };
}

/** People who hold a level in this workspace and in no other: anchored here, and every membership they hold is here (or they hold none). */
export function holdsALevelOnlyIn(organizationId: string): Prisma.UserWhereInput {
  return { organizationId, organizationMemberships: { every: { organizationId } } };
}

/**
 * The check-ins that belong to this workspace's reads of someone else
 * (THE WORKSPACE A CHECK-IN BELONGS TO, above): written here, or written
 * before check-ins named a workspace by someone whose only workspace is this
 * one.
 */
export function checkInsOfWorkspace(organizationId: string): Prisma.CheckInWhereInput {
  return { OR: [{ organizationId }, { organizationId: null, user: holdsALevelOnlyIn(organizationId) }] };
}

/** The viewer's own check-ins as read in this workspace: written here, or before check-ins named a workspace (their own, wherever they work). */
function ownHere(ctx: PeopleCtx): Prisma.CheckInWhereInput {
  return { userId: ctx.userId, OR: [{ organizationId: ctx.organizationId }, { organizationId: null }] };
}

/** Someone else's check-ins as this workspace reads them: they hold a level here, and the row belongs here. */
function othersHere(organizationId: string): Prisma.CheckInWhereInput[] {
  return [{ user: holdsALevelIn(organizationId) }, checkInsOfWorkspace(organizationId)];
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
 * here whose people data they read (THE RULE, above), as one where, each
 * only of this workspace (THE WORKSPACE A CHECK-IN BELONGS TO). The same
 * ladder as readsPeopleDataOf, so a list never holds a row a single read of
 * that person would refuse (check-in-access.test.ts holds the two equal).
 * GET /api/check-ins?userId= reads this where too, narrowed to the person.
 */
export function readableCheckInsWhere(ctx: PeopleCtx): Prisma.CheckInWhereInput {
  const own = ownHere(ctx);
  if (ctx.orgRole === "GUEST") return own;
  if (readsEveryone(ctx)) return { OR: [own, { AND: othersHere(ctx.organizationId) }] };
  const chain = [...ctx.chain].filter((id) => id !== ctx.userId);
  return chain.length === 0 ? own : { OR: [own, { userId: { in: chain }, AND: othersHere(ctx.organizationId) }] };
}

/** What this viewer reads here, for a digest's labels: everyone's here, their own and their people's, or their own alone. */
export function checkInReach(ctx: PeopleCtx): "workspace" | "team" | "own" {
  if (ctx.orgRole === "GUEST") return "own";
  if (readsEveryone(ctx)) return "workspace";
  return [...ctx.chain].some((id) => id !== ctx.userId) ? "team" : "own";
}

/** May this viewer read this one person's check-ins? Their own, or people data they read of someone who holds a level here. Which rows: readableCheckInsWhere. */
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
