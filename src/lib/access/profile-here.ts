// A person's profile as one workspace shows it (docs/plans/workspace-status.md
// D18, the step 3 review H2): a department, job role or office only when it
// is THIS workspace's own, and a manager only while that manager holds a
// seat here. Since D18 a move swaps the profile with the level, so an
// account's department is the workspace it is anchored to; this is the
// defence in depth for rows written before (or by a path that forgot), so no
// surface ever names another company's department, title, office or people.
// Every surface that shows those fields reads them through here: Members,
// the person's record, the Directory, the Org chart and the export.
//
// SOMEONE WHO WORKS HERE THROUGH A MEMBERSHIP (the final review, product H1,
// security M1). Their account's department, job role and office are the
// workspace the account is anchored to, today, by design (D18), so they are
// never shown here. What this workspace holds of them is on their
// membership (departmentId, roleId, officeId, weeklyCapacityHours,
// joinDate): placementsHere resolves those ids to this workspace's own rows
// (by id AND workspace, then ownHere), and seatPlacementsHere reads, for
// any people, the ids this workspace holds: the account's for someone
// anchored here, the membership's for anyone else. Edited here on the
// membership since docs/plans/workspace-status-2.md step 5 (E7).

import type { Prisma, PrismaClient } from "@/generated/prisma";
import { prisma } from "@/lib/prisma";
import { levelsHeldIn } from "./acting-workspace";
import { anchoredAtReach, anchoredHereWhere, membershipAtReach, membershipHereWhere, type Reach, type SeatReach } from "./seated-here";

type Db = PrismaClient | Prisma.TransactionClient;

/**
 * The row (a Department, Role or Office, read with its organizationId) when
 * it belongs to this workspace, without the organizationId; null otherwise.
 */
export function ownHere<T extends { organizationId: string }>(row: T | null | undefined, organizationId: string): Omit<T, "organizationId"> | null {
  if (!row || row.organizationId !== organizationId) return null;
  const { organizationId: _own, ...rest } = row;
  void _own;
  return rest;
}

/**
 * Of these managers, the ones who hold a seat here, deactivated or not (kept
 * seats, as a record names them): anchored here, or a membership here not
 * removed. Anyone else is never named here.
 */
export async function managersWithSeatHere(organizationId: string, ids: ReadonlyArray<string | null | undefined>, db: Db = prisma): Promise<Set<string>> {
  const want = [...new Set(ids.filter((x): x is string => !!x))];
  if (want.length === 0) return new Set();
  return new Set((await levelsHeldIn(organizationId, want, db, { keptSeats: true })).keys());
}

/** A department, job role and office as one workspace shows them: its own rows, or null. */
export interface PlacementRows {
  department: Map<string, { id: string; name: string; color: string | null }>;
  role: Map<string, { id: string; title: string; level: string; description: string | null }>;
  office: Map<string, { id: string; name: string; city: string | null; country: string | null; isHeadquarters: boolean }>;
}

/**
 * The department, job role and office rows these ids name, kept only when
 * they belong to this workspace (read by id and workspace, then ownHere):
 * a stale id, one of a row deleted since or of another workspace, is never
 * resolved. At most three reads, only for the ids named.
 */
export async function placementsHere(
  organizationId: string,
  rows: ReadonlyArray<{ departmentId?: string | null; roleId?: string | null; officeId?: string | null }>,
  db: Db = prisma,
): Promise<PlacementRows> {
  const ids = (k: "departmentId" | "roleId" | "officeId") => [...new Set(rows.map((r) => r[k]).filter((x): x is string => !!x))];
  const [d, r, o] = [ids("departmentId"), ids("roleId"), ids("officeId")];
  const [departments, roles, offices] = await Promise.all([
    d.length ? db.department.findMany({ where: { id: { in: d }, organizationId }, select: { id: true, name: true, color: true, organizationId: true } }) : Promise.resolve([]),
    r.length ? db.role.findMany({ where: { id: { in: r }, organizationId }, select: { id: true, title: true, level: true, description: true, organizationId: true } }) : Promise.resolve([]),
    o.length ? db.office.findMany({ where: { id: { in: o }, organizationId }, select: { id: true, name: true, city: true, country: true, isHeadquarters: true, organizationId: true } }) : Promise.resolve([]),
  ]);
  const own = <T extends { id: string; organizationId: string }>(list: readonly T[]) =>
    new Map(list.map((x) => [x.id, ownHere(x, organizationId)] as const).filter((e): e is [string, Omit<T, "organizationId">] => e[1] !== null));
  return {
    department: own(departments) as PlacementRows["department"],
    role: own(roles.map((x) => ({ ...x, level: String(x.level) }))) as PlacementRows["role"],
    office: own(offices) as PlacementRows["office"],
  };
}

/** What a membership holds of a person here (D18): the ids and the two numbers, read from the row. */
export interface MembershipProfileHere {
  departmentId: string | null;
  roleId: string | null;
  officeId: string | null;
  weeklyCapacityHours: number | null;
  joinDate: Date | null;
}

/** The select that reads MembershipProfileHere from an OrganizationMembership row. */
export const MEMBERSHIP_PROFILE_SELECT = { departmentId: true, roleId: true, officeId: true, weeklyCapacityHours: true, joinDate: true } as const;

/**
 * For each of these people, the department, job role and office ids THIS
 * workspace holds of them: the account's own for someone anchored here, the
 * membership's here for anyone else (a person with no membership here holds
 * none). One read of the memberships, only for the people anchored
 * elsewhere. Resolve them with placementsHere.
 */
export async function seatPlacementsHere(
  organizationId: string,
  people: ReadonlyArray<{ id: string; organizationId: string; departmentId?: string | null; roleId?: string | null; officeId?: string | null }>,
  db: Db = prisma,
): Promise<Map<string, { departmentId: string | null; roleId: string | null; officeId: string | null }>> {
  const out = new Map<string, { departmentId: string | null; roleId: string | null; officeId: string | null }>();
  const elsewhere: string[] = [];
  for (const p of people) {
    if (p.organizationId === organizationId) out.set(p.id, { departmentId: p.departmentId ?? null, roleId: p.roleId ?? null, officeId: p.officeId ?? null });
    else elsewhere.push(p.id);
  }
  if (elsewhere.length > 0) {
    const rows = await db.organizationMembership.findMany({
      where: { organizationId, userId: { in: [...new Set(elsewhere)] } },
      select: { userId: true, departmentId: true, roleId: true, officeId: true },
    });
    for (const r of rows) out.set(r.userId, { departmentId: r.departmentId, roleId: r.roleId, officeId: r.officeId });
  }
  return out;
}

/** A person row's department, job role and office each as one workspace shows them: its own (without organizationId), or null. */
export type PlacedHere<T> = {
  [K in keyof T]: K extends "department" | "role" | "office"
    ? T[K] extends { organizationId: string } | null | undefined
      ? Omit<NonNullable<T[K]>, "organizationId"> | null
      : T[K]
    : T[K];
};

/**
 * A person row (read with each placement's organizationId) with its
 * department, job role and office kept only when this workspace's own
 * (ownHere), everything else as it is. For the surfaces that list people by
 * this workspace's records (reviews, assignments, assets, access rows),
 * where someone who works here through a membership can appear: their
 * account's placement is the workspace it is anchored to (D18; the final
 * review, security M1), so it is never shown here. Null stays null.
 */
export function placedHere<T extends Record<string, unknown>>(person: T, organizationId: string): PlacedHere<T>;
export function placedHere<T extends Record<string, unknown>>(person: T | null, organizationId: string): PlacedHere<T> | null;
export function placedHere<T extends Record<string, unknown>>(person: T | null, organizationId: string): PlacedHere<T> | null {
  if (!person) return null;
  const out: Record<string, unknown> = { ...person };
  for (const k of ["department", "role", "office"] as const) {
    if (k in out) out[k] = ownHere(out[k] as { organizationId: string } | null | undefined, organizationId);
  }
  return out as PlacedHere<T>;
}

/**
 * How many people here through a membership (a seat here not removed, their
 * account not removed where it is anchored) hold this department, job title
 * or office on their membership here: the membership half of "who is placed
 * there" (docs/plans/workspace-status-2.md, the step 5 review M2). A delete
 * of a department, an office or a job title adds it to its own count of the
 * people anchored here, so it never deletes one a membership person still
 * holds without saying so (their membership would keep a dead id, shown as
 * nothing anywhere). Step 8's helpers below (E15) read both halves for the
 * audiences and the listed counts.
 */
export async function membershipsPlacedHere(
  organizationId: string,
  placement: { departmentId: string } | { roleId: string } | { officeId: string },
  db: Db = prisma,
): Promise<number> {
  return db.organizationMembership.count({ where: { ...membershipHereWhere(organizationId, "kept"), ...placement } });
}

// AUDIENCES AND COUNTS BY PLACEMENT (docs/plans/workspace-status-2.md E15,
// step 8). Everywhere an audience or a count is built from the people placed
// in a department, a job title, an office or the whole workspace, it reads
// them here: the people anchored here by their account's placement, and the
// people here through a membership by the placement that membership holds
// (D18), each at their seat's state. Two indexed halves, never one OR with a
// membership sublink (seated-here.ts): people anchored here by
// "User_organizationId_idx", memberships here by
// "OrganizationMembership_organizationId_idx". The membership half leaves
// out the people anchored here (membershipHereWhere), so someone anchored
// here who still holds a stale membership row here is counted once, at
// their account.
//
// THE REACH. An audience (who is told, who may read or answer) keeps the
// rule it had for the people anchored here and needs a LIVE seat for a
// membership person, so nobody this workspace ended is told anything from
// it: what it sends (a notification row, an email) belongs to the account
// and is read in whichever workspace the account is in. A count keeps its
// own rule (the Settings counts read kept seats for both kinds, the rule the
// deletes refuse by). Each caller passes its reach.
//
// NOT HERE: KRA and SOP assignment by job title or department (the KRA
// seeding to a job title's holders, an SOP assigned to a department or
// everyone, a review cycle's launch). Those read the people anchored here
// only: a membership person's KRAs, SOPs and reviews here are a known limit
// (the step 5 review M1), so none is made for them.

/**
 * The reach of an audience that tells people something (an announcement, a
 * policy, a survey, a Candor session): the people anchored here who are not
 * removed, the rule each read before this step, and the people here through
 * a membership while their seat here is live.
 */
export const AUDIENCE_REACH = { anchored: "kept", membership: "live" } as const satisfies Reach;

/** The department, job title and office ids THIS workspace holds of a person, at their seat here. */
export interface PlacementIds {
  departmentId: string | null;
  roleId: string | null;
  officeId: string | null;
}

/** Any of these placements places a person; "everyone" is the whole workspace. */
export interface PlacedBy {
  departmentIds?: readonly (string | null | undefined)[];
  roleIds?: readonly (string | null | undefined)[];
  officeIds?: readonly (string | null | undefined)[];
}

/** Someone placed here, with the placement their seat here holds. */
export interface PlacedPerson extends PlacementIds {
  id: string;
  kind: "anchor" | "membership";
  firstName: string;
  lastName: string;
  email: string;
  avatar: string | null;
}

/** What peoplePlacedHere narrows by: only these people (a viewer's scope, a team), or one half only. */
export interface PlacedOpts {
  among?: Iterable<string>;
  /** One half only, for a caller that reads the other itself (a filter by a relation of the people anchored here). */
  only?: "anchor" | "membership";
  db?: Db;
}

function reachOf(reach: Reach): { anchored: SeatReach; membership: SeatReach } {
  return typeof reach === "string" ? { anchored: reach, membership: reach } : reach;
}

type PlaceColumns = { departmentId?: { in: string[] }; roleId?: { in: string[] }; officeId?: { in: string[] } };

/** The placement conditions (on the seat's own row, either kind), or null when they name nobody. */
function placeConditions(by: PlacedBy | "everyone"): PlaceColumns[] | null {
  if (by === "everyone") return [];
  const out: PlaceColumns[] = [];
  const add = (column: keyof PlaceColumns, ids: PlacedBy[keyof PlacedBy]) => {
    const list = [...new Set((ids ?? []).filter((x): x is string => typeof x === "string" && x.length > 0))];
    if (list.length > 0) out.push({ [column]: { in: list } });
  };
  add("departmentId", by.departmentIds);
  add("roleId", by.roleIds);
  add("officeId", by.officeIds);
  return out.length > 0 ? out : null;
}

/**
 * The placement this workspace holds of one person at their seat here: the
 * account's own department, job title and office where they are anchored
 * here, their membership's here otherwise (D18), never another workspace's.
 * Null when they hold no seat here at this reach (or have no account). Two
 * reads at most, by key. For the audience checks of one viewer (a goal, an
 * announcement, a survey, a Candor session, the boot's facts), which read
 * the account's own placement before this step, so someone who works here
 * through a membership was in no department, job title or office here.
 */
export async function placementHereOf(organizationId: string, userId: string, reach: Reach = "any", db: Db = prisma): Promise<PlacementIds | null> {
  const r = reachOf(reach);
  const u = await db.user.findUnique({ where: { id: userId }, select: { organizationId: true, status: true, deletedAt: true, departmentId: true, roleId: true, officeId: true } });
  if (!u) return null;
  const account = { status: String(u.status), deletedAt: u.deletedAt ?? null };
  if (u.organizationId === organizationId) {
    return anchoredAtReach(account, r.anchored) ? { departmentId: u.departmentId ?? null, roleId: u.roleId ?? null, officeId: u.officeId ?? null } : null;
  }
  const m = await db.organizationMembership.findUnique({
    where: { userId_organizationId: { userId, organizationId } },
    select: { status: true, removedAt: true, departmentId: true, roleId: true, officeId: true },
  });
  if (!m || !membershipAtReach({ status: String(m.status), removedAt: m.removedAt ?? null }, account, r.membership)) return null;
  return { departmentId: m.departmentId ?? null, roleId: m.roleId ?? null, officeId: m.officeId ?? null };
}

/**
 * Everyone placed here in any of these departments, job titles or offices
 * (or, for "everyone", the whole workspace), at this reach, each with the
 * placement their seat here holds and their name card: the two halves (see
 * above), people anchored here first, each half in id order. Nobody is
 * answered twice. `among` narrows both halves to these people.
 */
export async function peoplePlacedHere(organizationId: string, by: PlacedBy | "everyone", reach: Reach, opts: PlacedOpts = {}): Promise<PlacedPerson[]> {
  const halves = placedHalves(organizationId, by, reach, opts);
  if (!halves) return [];
  const db = opts.db ?? prisma;
  const card = { firstName: true, lastName: true, email: true, avatar: true } as const;
  const [anchored, members] = await Promise.all([
    halves.anchored ? db.user.findMany({ where: halves.anchored, select: { id: true, departmentId: true, roleId: true, officeId: true, ...card }, orderBy: { id: "asc" } }) : [],
    halves.membership
      ? db.organizationMembership.findMany({ where: halves.membership, select: { userId: true, departmentId: true, roleId: true, officeId: true, user: { select: card } }, orderBy: { userId: "asc" } })
      : [],
  ]);
  const cardOf = (u: { firstName: string; lastName: string; email: string; avatar: string | null } | null | undefined) => ({
    firstName: u?.firstName ?? "",
    lastName: u?.lastName ?? "",
    email: u?.email ?? "",
    avatar: u?.avatar ?? null,
  });
  return [
    ...anchored.map((u) => ({ id: u.id, kind: "anchor" as const, departmentId: u.departmentId ?? null, roleId: u.roleId ?? null, officeId: u.officeId ?? null, ...cardOf(u) })),
    ...members.map((m) => ({ id: m.userId, kind: "membership" as const, departmentId: m.departmentId ?? null, roleId: m.roleId ?? null, officeId: m.officeId ?? null, ...cardOf(m.user) })),
  ];
}

/**
 * The two halves' conditions for a placement read (see peoplePlacedHere), or
 * null when they name nobody; a half left out (`only`) is null.
 */
function placedHalves(
  organizationId: string,
  by: PlacedBy | "everyone",
  reach: Reach,
  opts: PlacedOpts,
): { anchored: Prisma.UserWhereInput | null; membership: Prisma.OrganizationMembershipWhereInput | null } | null {
  const place = placeConditions(by);
  if (!place) return null;
  const among = opts.among ? [...new Set(opts.among)] : null;
  if (among && among.length === 0) return null;
  const r = reachOf(reach);
  const placed = place.length === 0 ? {} : place.length === 1 ? place[0] : { OR: place };
  return {
    anchored: opts.only === "membership" ? null : { ...anchoredHereWhere(organizationId, r.anchored), ...placed, ...(among ? { id: { in: among } } : {}) },
    membership: opts.only === "anchor" ? null : { ...membershipHereWhere(organizationId, r.membership), ...placed, ...(among ? { userId: { in: among } } : {}) },
  };
}

/** The ids of peoplePlacedHere, read as ids only (no name card), each half in id order. */
export async function idsPlacedHere(organizationId: string, by: PlacedBy | "everyone", reach: Reach, opts: PlacedOpts = {}): Promise<string[]> {
  const halves = placedHalves(organizationId, by, reach, opts);
  if (!halves) return [];
  const db = opts.db ?? prisma;
  const [anchored, members] = await Promise.all([
    halves.anchored ? db.user.findMany({ where: halves.anchored, select: { id: true }, orderBy: { id: "asc" } }) : [],
    halves.membership ? db.organizationMembership.findMany({ where: halves.membership, select: { userId: true }, orderBy: { userId: "asc" } }) : [],
  ]);
  return [...anchored.map((u) => u.id), ...members.map((m) => m.userId)];
}

/**
 * How many people peoplePlacedHere would answer, counted in the two halves
 * (two counts, no rows read): a survey list's audience size per row (the
 * step 8 review L2).
 */
export async function countPlacedHere(organizationId: string, by: PlacedBy | "everyone", reach: Reach, opts: PlacedOpts = {}): Promise<number> {
  const halves = placedHalves(organizationId, by, reach, opts);
  if (!halves) return 0;
  const db = opts.db ?? prisma;
  const [a, b] = await Promise.all([
    halves.anchored ? db.user.count({ where: halves.anchored }) : 0,
    halves.membership ? db.organizationMembership.count({ where: halves.membership }) : 0,
  ]);
  return a + b;
}

/**
 * The membership half of a listed count by placement: for each department,
 * job title or office id, how many people here through a membership hold it
 * on their membership at this reach (kept, for the Settings lists, the rule
 * their deletes refuse by). The caller adds it to its own count of the
 * people anchored here (a relation `_count`), so the list offers a Delete
 * only where the delete goes through. Anyone anchored here is never in this
 * half, so a stale membership row of theirs adds nothing.
 */
export async function membershipPlacedCounts(
  organizationId: string,
  column: "departmentId" | "roleId" | "officeId",
  reach: SeatReach = "kept",
  db: Db = prisma,
): Promise<Map<string, number>> {
  // One row per department, job title or office (the step 8 review L3),
  // never a row per membership.
  const where = { ...membershipHereWhere(organizationId, reach), [column]: { not: null } };
  const rows =
    column === "departmentId"
      ? (await db.organizationMembership.groupBy({ by: ["departmentId"], where, _count: { _all: true } })).map((g) => [g.departmentId, g._count._all] as const)
      : column === "roleId"
        ? (await db.organizationMembership.groupBy({ by: ["roleId"], where, _count: { _all: true } })).map((g) => [g.roleId, g._count._all] as const)
        : (await db.organizationMembership.groupBy({ by: ["officeId"], where, _count: { _all: true } })).map((g) => [g.officeId, g._count._all] as const);
  const out = new Map<string, number>();
  for (const [id, n] of rows) if (id) out.set(id, (out.get(id) ?? 0) + n);
  return out;
}
