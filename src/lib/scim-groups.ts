// SCIM Groups are this workspace's departments (src/app/api/scim/v2/Groups):
// a group's members are the people who hold a seat here placed in that
// department, and an identity provider's member add, remove and replace
// place them there (docs/plans/workspace-status-2.md E9 ii, step 5).
//
// EACH PERSON AT THE SEAT THEY HOLD HERE. Someone anchored here is placed by
// their account's department (User.departmentId); someone here through a
// membership by their membership's (D18), never their account's, which is
// the workspace it is anchored to. Before step 5 a group read and wrote the
// account only (`organizationId` here), so B's Engineering sync never placed
// Pat, who works at B through a membership, and B's department filter,
// groupings and audiences missed her.
//
// Read in two indexed halves (seated-here.ts): the people anchored here by
// department, and the memberships here by department, the person anchored
// elsewhere. A seat removed here is neither listed nor written: its row is
// the record for a restore (D8), and an identity provider never sees as a
// member someone it cannot take out. Every write goes through
// seat-writes.ts writeProfileHere, under the person's row lock, on the row
// that holds the seat; a person with no seat here (or a removed one) is
// skipped, as before for anyone not anchored here.
//
// A member's write is one small transaction (their lock, their seat read,
// the write). A deadlock Postgres broke, or a transaction past its time,
// wrote nothing for that person: the route answers the 503 an identity
// provider retries (groupWriteRetry), never a 500 (the step 5 review L5).
//
// Server only (prisma).

import { prisma } from "@/lib/prisma";
import { anchoredHereWhere, membershipHereWhere } from "@/lib/access/seated-here";
import { lockPerson } from "@/lib/access/workspace-anchor";
import { seatRefOf, writeProfileHere } from "@/lib/access/seat-writes";
import { membershipsPlacedHere } from "@/lib/access/profile-here";
import { retryAnswer } from "@/lib/access/org-roles-busy";

/** A group member as SCIM lists them. */
export interface GroupMember {
  id: string;
  display: string;
}

const CARD = { id: true, firstName: true, lastName: true, email: true } as const;

function display(u: { firstName: string | null; lastName: string | null; email: string }): string {
  return `${u.firstName ?? ""} ${u.lastName ?? ""}`.trim() || u.email;
}

/**
 * The members of each of these departments here: everyone who holds a seat
 * here (not removed) placed in it, both kinds, by name. Keyed by
 * department id; a department with nobody is an empty list.
 */
export async function groupMembersHere(organizationId: string, departmentIds: readonly string[]): Promise<Map<string, GroupMember[]>> {
  const out = new Map<string, GroupMember[]>(departmentIds.map((id) => [id, []]));
  if (departmentIds.length === 0) return out;
  const ids = [...new Set(departmentIds)];
  const [anchored, members] = await Promise.all([
    prisma.user.findMany({ where: { ...anchoredHereWhere(organizationId, "kept"), departmentId: { in: ids } }, select: { ...CARD, departmentId: true } }),
    prisma.organizationMembership.findMany({ where: { ...membershipHereWhere(organizationId, "kept"), departmentId: { in: ids } }, select: { departmentId: true, user: { select: CARD } } }),
  ]);
  const rows = [
    ...anchored.map((u) => ({ departmentId: u.departmentId, person: u })),
    ...members.map((m) => ({ departmentId: m.departmentId, person: m.user })),
  ];
  rows.sort((a, b) => display(a.person).localeCompare(display(b.person)) || a.person.id.localeCompare(b.person.id));
  for (const r of rows) if (r.departmentId) out.get(r.departmentId)?.push({ id: r.person.id, display: display(r.person) });
  return out;
}

/** How many people here (not removed, both kinds) are placed in this department. */
export async function groupMemberCountHere(organizationId: string, departmentId: string): Promise<number> {
  const [anchored, members] = await Promise.all([
    prisma.user.count({ where: { ...anchoredHereWhere(organizationId, "kept"), departmentId } }),
    membershipsPlacedHere(organizationId, { departmentId }),
  ]);
  return anchored + members;
}

/**
 * Sets one person's department HERE to `next` (null takes them out), on the
 * row that holds their seat here, under their row lock. With `onlyFrom`, only
 * while their department here is still that one (a remove from a group never
 * takes someone out of another department they were moved to since). False
 * when nothing was written: no seat here (or a removed one), already there,
 * or no longer in `onlyFrom`.
 */
async function placeHere(organizationId: string, userId: string, next: string | null, onlyFrom?: string): Promise<boolean> {
  return prisma.$transaction(async (tx) => {
    await lockPerson(tx, userId);
    const account = await tx.user.findUnique({ where: { id: userId }, select: { id: true, organizationId: true, deletedAt: true, departmentId: true } });
    if (!account) return false;
    let held: string | null;
    if (account.organizationId === organizationId) {
      if (account.deletedAt) return false;
      held = account.departmentId ?? null;
    } else {
      const m = await tx.organizationMembership.findFirst({ where: { ...membershipHereWhere(organizationId, "kept"), userId }, select: { departmentId: true } });
      if (!m) return false;
      held = m.departmentId ?? null;
    }
    if (onlyFrom !== undefined && held !== onlyFrom) return false;
    if (held === next) return false;
    return writeProfileHere(tx, seatRefOf(organizationId, account), { departmentId: next });
  });
}

/** Places these people in the department here (a group's member add). Answers how many moved. */
export async function addToGroupHere(organizationId: string, departmentId: string, userIds: readonly string[]): Promise<number> {
  let n = 0;
  for (const id of [...new Set(userIds)].sort()) if (await placeHere(organizationId, id, departmentId)) n += 1;
  return n;
}

/** Takes these people out of the department here, each only while they are still in it (a group's member remove). Answers how many. */
export async function removeFromGroupHere(organizationId: string, departmentId: string, userIds: readonly string[]): Promise<number> {
  let n = 0;
  for (const id of [...new Set(userIds)].sort()) if (await placeHere(organizationId, id, null, departmentId)) n += 1;
  return n;
}

/**
 * A group's full member replace (SCIM PUT): everyone here in the department
 * and not named is taken out (left with no department: which other one to
 * fall back to is not known), and everyone named is placed in it.
 */
export async function replaceGroupHere(organizationId: string, departmentId: string, userIds: readonly string[]): Promise<void> {
  const keep = new Set(userIds);
  const current = (await groupMembersHere(organizationId, [departmentId])).get(departmentId) ?? [];
  await removeFromGroupHere(organizationId, departmentId, current.map((m) => m.id).filter((id) => !keep.has(id)));
  await addToGroupHere(organizationId, departmentId, [...keep]);
}

/**
 * Runs a group's member writes; the sentence of the 503 "try again" when one
 * of them was busy, deadlocked or ran out of its time (each wrote nothing for
 * its person, and a provider's retry writes what is left), or null when all
 * ran. Any other error is thrown on.
 */
export async function groupWriteRetry(run: () => Promise<unknown>): Promise<string | null> {
  try {
    await run();
    return null;
  } catch (e) {
    const busy = retryAnswer(e);
    if (busy) return busy.error;
    throw e;
  }
}
