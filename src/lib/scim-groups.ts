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
// seat-writes.ts placeDepartmentHere, under the people's row locks, on the
// row that holds each seat; a person with no seat here (or a removed one) is
// skipped, as before for anyone not anchored here.
//
// A request's member writes are ONE transaction (the step 9 live proof: one
// per member made a Group PUT of 5,000 take about 21 seconds): the people
// locked in id order in one statement, then each half written by one
// guarded statement, with the same rows and guards as writeProfileHere on
// each seat. A deadlock Postgres broke, or a transaction past its time
// (BATCH_TX, 20 seconds), wrote nothing: the route answers the 503 an
// identity provider retries (groupWriteRetry), never a 500 (the step 5
// review L5), and the retry writes it all.
//
// Server only (prisma).

import { prisma } from "@/lib/prisma";
import { anchoredHereWhere, membershipHereWhere } from "@/lib/access/seated-here";
import { lockPeople } from "@/lib/access/workspace-anchor";
import { placeDepartmentHere } from "@/lib/access/seat-writes";
import { membershipsPlacedHere } from "@/lib/access/profile-here";
import { BATCH_TX, placementRetryAnswer } from "@/lib/access/org-roles-busy";

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

/** Places these people in the department here (a group's member add), in one transaction. Answers how many moved. */
export async function addToGroupHere(organizationId: string, departmentId: string, userIds: readonly string[]): Promise<number> {
  const moved = await prisma.$transaction((tx) => placeDepartmentHere(tx, { organizationId, userIds, departmentId }), BATCH_TX);
  return moved.length;
}

/** Takes these people out of the department here, each only while they are still in it (a group's member remove), in one transaction. Answers how many. */
export async function removeFromGroupHere(organizationId: string, departmentId: string, userIds: readonly string[]): Promise<number> {
  const moved = await prisma.$transaction((tx) => placeDepartmentHere(tx, { organizationId, userIds, departmentId: null, onlyFrom: departmentId }), BATCH_TX);
  return moved.length;
}

/**
 * A group's full member replace (SCIM PUT): everyone here in the department
 * and not named is taken out (left with no department: which other one to
 * fall back to is not known), and everyone named is placed in it. One
 * transaction: everyone it touches is locked first, in id order, in one
 * statement, so the two writes after it take no lock out of that order.
 */
export async function replaceGroupHere(organizationId: string, departmentId: string, userIds: readonly string[]): Promise<void> {
  const keep = [...new Set(userIds)];
  const named = new Set(keep);
  const current = (await groupMembersHere(organizationId, [departmentId])).get(departmentId) ?? [];
  const out = current.map((m) => m.id).filter((id) => !named.has(id));
  await prisma.$transaction(async (tx) => {
    await lockPeople(tx, [...out, ...keep]);
    await placeDepartmentHere(tx, { organizationId, userIds: out, departmentId: null, onlyFrom: departmentId });
    await placeDepartmentHere(tx, { organizationId, userIds: keep, departmentId });
  }, BATCH_TX);
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
    // A department write takes no role lock: a deadlock is "someone else is changing people" (the final review, product L6).
    const busy = placementRetryAnswer(e);
    if (busy) return busy.error;
    throw e;
  }
}
