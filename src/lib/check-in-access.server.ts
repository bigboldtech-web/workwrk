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
// member and org-wide level read them.
//
// SETTLED ONCE (docs-found fixes batch 7). Others read a row only by its own
// column: organizationId = this workspace. Nothing about the person is asked
// on a read. Batch 6 decided a row from before the column (null) on every
// read: others read it where its person held a level in this workspace
// alone. Two things were wrong with that. Its "every membership is here"
// test compiled to a NOT IN over every other workspace's memberships, a scan
// of that whole table on each read. And its answer could change later: a
// workspace's hard delete cascades its memberships, so Dana's older Acme
// rows became Globex's to read the day Acme was deleted. Now
// prisma/sql/2026-10-12-check-in-backfill.sql decides each older row once,
// at deploy: a row whose person then held a level in exactly one workspace
// (anchored there, no membership in another) was written as that
// workspace's. Every row still null after it (its person worked in two or
// more, or it was skipped) is read only by its person, wherever they work,
// and no deletion can ever widen who reads a row.
//
// A ROW WRITTEN HERE IS OF SOMEONE WHO HOLDS A LEVEL HERE, so no read asks
// that either (batch 5 asked it with an OR and a membership sublink, which
// the planner may run as a scan of every workspace's User rows). POST writes
// the session's workspace, and a session acts only where its person holds a
// level; nothing takes that level away while the row exists: no route
// deletes a membership, a move between workspaces keeps the one left as a
// membership (workspace-anchor.ts), and a workspace's hard delete or an
// account's erasure deletes the rows with it (the foreign keys cascade). A
// removed account (deletedAt) is still anchored here, as before. So the list
// and the one-person read (mayReadCheckInsOf, by id) agree on every row
// there can be.
//
// Worst case of this: a person in two workspaces before the column has
// older check-ins only they read, which no screen shows anyway. Worst case
// of any guess: health-grade notes about one employer shown to another.
//
// Server-only (prisma, the session's people context).

import type { Prisma } from "@/generated/prisma";
import { levelHeldIn } from "@/lib/access/acting-workspace";
import { readsPeopleDataOf, type PeopleCtx } from "@/lib/people/person-access.server";

/** The viewer's own check-ins as read in this workspace: written here, or still naming no workspace (their own, wherever they work). */
function ownHere(ctx: PeopleCtx): Prisma.CheckInWhereInput {
  return { userId: ctx.userId, OR: [{ organizationId: ctx.organizationId }, { organizationId: null }] };
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
 * only of this workspace (THE WORKSPACE A CHECK-IN BELONGS TO, SETTLED
 * ONCE). The same ladder as readsPeopleDataOf, so a list never holds a row
 * a single read of that person would refuse (check-in-access.test.ts holds
 * the two equal). GET /api/check-ins?userId= reads this where too, narrowed
 * to the person. Every branch starts from an indexed CheckIn column (userId,
 * or organizationId with createdAt), and none reads User or the
 * memberships.
 */
export function readableCheckInsWhere(ctx: PeopleCtx): Prisma.CheckInWhereInput {
  const own = ownHere(ctx);
  if (ctx.orgRole === "GUEST") return own;
  // Someone else's: only a row written here (SETTLED ONCE), by its own
  // indexed column, never a test of the person.
  const here = { organizationId: ctx.organizationId };
  if (readsEveryone(ctx)) return { OR: [own, here] };
  const chain = [...ctx.chain].filter((id) => id !== ctx.userId);
  return chain.length === 0 ? own : { OR: [own, { userId: { in: chain }, ...here }] };
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
