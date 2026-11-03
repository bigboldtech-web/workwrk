// Everyone who holds a seat in ONE workspace, for the people pickers, the
// rosters, the checks that accept a person to assign, message, mention or
// hand work to, and Workload (docs/plans/workspace-status-2.md E12 to E14,
// step 6). A seat is the account row where the person is anchored and their
// membership row everywhere else (workspace-status.md D1). Here each kind is
// read at its own row, never by the account alone, so someone who last
// opened another company is offered, accepted and counted here exactly as
// someone anchored here, with THIS workspace's values: the level held here,
// the seat's status and removal, and the placement the membership holds
// (D18).
//
// FOUR REACHES. Each is a rule a caller already applied to people anchored
// here, read at the seat:
//   any     a seat here in any state, a removed one included (a caller that
//           matched people by `organizationId` alone).
//   kept    not removed here: anchored here with deletedAt null, or a
//           membership here not removed (deactivated included).
//   live    can still work here: also not deactivated here (an HR label such
//           as On leave is live). A membership also needs its account not
//           ended (D12, as liveMembersHere counts).
//   active  live, at plain ACTIVE (no HR label): the default pickers.
// A caller may split the two kinds (`{ anchored, membership }`): a check that
// keeps today's rule for people anchored here and needs a live seat for a
// membership person, because what it sends (a notification row) belongs to
// the account and would be read from another workspace by someone this one
// ended.
//
// TWO INDEXED HALVES, never one OR with a membership sublink (docs-found
// fixes batch 6): people anchored here by "User_organizationId_idx", and
// memberships here by "OrganizationMembership_organizationId_idx" with each
// person then by "User_pkey". The membership half leaves out the people
// anchored here, so the anchored workspace's own stale membership row is
// never read as their seat and nobody is answered twice. A list is read by
// name in both halves and merged (peopleHereByName); a check by id reads the
// people first, then the memberships of those anchored elsewhere
// (peopleHereAmong).
//
// Lives under src/lib/access/: it reads the level a membership holds.

import type { AccessLevel, Prisma, PrismaClient } from "@/generated/prisma";
import { prisma } from "@/lib/prisma";
import { ENDED_STATUS } from "./workspace-seat";
import { joinedHere } from "./joined-here";

type Db = PrismaClient | Prisma.TransactionClient;

export type SeatReach = "any" | "kept" | "live" | "active";

/** One reach for both kinds, or one for each. */
export type Reach = SeatReach | { anchored: SeatReach; membership: SeatReach };

function split(reach: Reach): { anchored: SeatReach; membership: SeatReach } {
  return typeof reach === "string" ? { anchored: reach, membership: reach } : reach;
}

/** The account row of someone anchored here, at this reach. */
export function anchoredHereWhere(organizationId: string, reach: SeatReach): Prisma.UserWhereInput {
  switch (reach) {
    case "any":
      return { organizationId };
    case "kept":
      return { organizationId, deletedAt: null };
    case "live":
      return { organizationId, deletedAt: null, status: { not: ENDED_STATUS } };
    case "active":
      return { organizationId, deletedAt: null, status: "ACTIVE" };
  }
}

/**
 * A membership here of someone anchored in another workspace, at this reach.
 * `person` narrows the person (search words, ids), for both halves alike.
 * A live or active seat needs the account not ended (D12); a kept one, the
 * account not removed where it is anchored (as inWorkspaceWhere's callers
 * read it with deletedAt null).
 */
export function membershipHereWhere(organizationId: string, reach: SeatReach, person: Prisma.UserWhereInput = {}): Prisma.OrganizationMembershipWhereInput {
  const elsewhere = { ...person, organizationId: { not: organizationId } };
  switch (reach) {
    case "any":
      return { organizationId, user: elsewhere };
    case "kept":
      return { organizationId, removedAt: null, user: { ...elsewhere, deletedAt: null } };
    case "live":
      return { organizationId, status: { not: ENDED_STATUS }, removedAt: null, user: { ...elsewhere, deletedAt: null, status: { not: ENDED_STATUS } } };
    case "active":
      return { organizationId, status: "ACTIVE", removedAt: null, user: { ...elsewhere, deletedAt: null, status: { not: ENDED_STATUS } } };
  }
}

interface AccountState {
  status: string;
  deletedAt: Date | null;
}

/** anchoredHereWhere as a predicate, for an account already read (anchored here). */
export function anchoredAtReach(account: AccountState, reach: SeatReach): boolean {
  if (reach === "any") return true;
  if (account.deletedAt != null) return false;
  if (reach === "kept") return true;
  if (reach === "live") return String(account.status) !== ENDED_STATUS;
  return String(account.status) === "ACTIVE";
}

/** membershipHereWhere as a predicate, for a membership read with its account. */
export function membershipAtReach(seat: { status: string; removedAt: Date | null }, account: AccountState, reach: SeatReach): boolean {
  if (reach === "any") return true;
  if (seat.removedAt != null || account.deletedAt != null) return false;
  if (reach === "kept") return true;
  if (String(account.status) === ENDED_STATUS) return false;
  if (reach === "live") return String(seat.status) !== ENDED_STATUS;
  return String(seat.status) === "ACTIVE";
}

/**
 * What this workspace holds of a person at their seat here: for someone
 * anchored here, their account row; for anyone else, their membership here
 * (D1, D18). Never another workspace's values.
 */
export interface SeatHere {
  kind: "anchor" | "membership";
  level: AccessLevel;
  status: string;
  /** Their removal here: User.deletedAt for the anchored, the membership's removedAt otherwise. */
  removedAt: Date | null;
  departmentId: string | null;
  roleId: string | null;
  officeId: string | null;
  /** Their join date here: the account's, or the membership's stored one, else when they joined here. */
  joinDate: Date | null;
  /**
   * For a membership seat: the account is ended where it is anchored
   * (removed, or deactivated there), so the seat here is not live whatever
   * its own status (D12). Always false for someone anchored here, whose
   * account row is the seat.
   */
  accountEnded: boolean;
}

/** A person card (what a picker row draws) with their seat here. */
export interface PersonHere {
  id: string;
  firstName: string;
  lastName: string;
  email: string;
  avatar: string | null;
  seat: SeatHere;
}

const CARD = { id: true, firstName: true, lastName: true, email: true, avatar: true } as const;
/** What a person is read with: the card, and the account's seat for someone anchored here. */
const PERSON_SELECT = { ...CARD, organizationId: true, accessLevel: true, status: true, deletedAt: true, departmentId: true, roleId: true, officeId: true, joinDate: true, createdAt: true } as const;
/** What a membership is read with. */
const MEMBERSHIP_SELECT = { userId: true, role: true, status: true, removedAt: true, departmentId: true, roleId: true, officeId: true, joinDate: true, createdAt: true, isPrimary: true } as const;

type PersonRow = Prisma.UserGetPayload<{ select: typeof PERSON_SELECT }>;
type MembershipRow = Prisma.OrganizationMembershipGetPayload<{ select: typeof MEMBERSHIP_SELECT }>;

function card(u: Pick<PersonRow, "id" | "firstName" | "lastName" | "email" | "avatar">): Omit<PersonHere, "seat"> {
  return { id: u.id, firstName: u.firstName, lastName: u.lastName, email: u.email, avatar: u.avatar ?? null };
}

function anchoredSeat(u: PersonRow): SeatHere {
  return {
    kind: "anchor",
    level: u.accessLevel,
    status: String(u.status),
    removedAt: u.deletedAt,
    departmentId: u.departmentId ?? null,
    roleId: u.roleId ?? null,
    officeId: u.officeId ?? null,
    joinDate: u.joinDate ?? null,
    accountEnded: false,
  };
}

function membershipSeat(m: MembershipRow, account: { createdAt: Date; status: string; deletedAt: Date | null }): SeatHere {
  return {
    kind: "membership",
    level: m.role,
    status: String(m.status),
    removedAt: m.removedAt,
    departmentId: m.departmentId ?? null,
    roleId: m.roleId ?? null,
    officeId: m.officeId ?? null,
    // The membership's own join date (D18), else when they joined here (joined-here.ts).
    joinDate: m.joinDate ?? joinedHere(m, account),
    accountEnded: account.deletedAt != null || String(account.status) === ENDED_STATUS,
  };
}

/**
 * These people, each with their seat here, keyed by id: those who hold a seat
 * here at this reach. By id first ("User_pkey"), then the memberships here of
 * the ones anchored elsewhere (the person and workspace unique key). Two
 * reads at most. Someone with no seat here, or one outside the reach, is
 * absent.
 */
export async function peopleHereAmong(organizationId: string, ids: readonly (string | null | undefined)[], reach: Reach, db: Db = prisma): Promise<Map<string, PersonHere>> {
  const want = [...new Set(ids.filter((x): x is string => typeof x === "string" && x.length > 0))];
  const out = new Map<string, PersonHere>();
  if (want.length === 0) return out;
  const r = split(reach);
  const users = await db.user.findMany({ where: { id: { in: want } }, select: PERSON_SELECT });
  const elsewhere = new Map<string, PersonRow>();
  for (const u of users) {
    if (u.organizationId === organizationId) {
      if (anchoredAtReach({ status: String(u.status), deletedAt: u.deletedAt }, r.anchored)) out.set(u.id, { ...card(u), seat: anchoredSeat(u) });
    } else elsewhere.set(u.id, u);
  }
  if (elsewhere.size > 0) {
    const seats = await db.organizationMembership.findMany({ where: { organizationId, userId: { in: [...elsewhere.keys()] } }, select: MEMBERSHIP_SELECT });
    for (const m of seats) {
      const u = elsewhere.get(m.userId);
      if (!u) continue;
      if (membershipAtReach({ status: String(m.status), removedAt: m.removedAt }, { status: String(u.status), deletedAt: u.deletedAt }, r.membership)) {
        out.set(u.id, { ...card(u), seat: membershipSeat(m, u) });
      }
    }
  }
  return out;
}

/** Of these people, the ids of those who hold a seat here at this reach (peopleHereAmong). */
export async function seatedHereAmong(organizationId: string, ids: readonly (string | null | undefined)[], reach: Reach, db: Db = prisma): Promise<Set<string>> {
  return new Set((await peopleHereAmong(organizationId, ids, reach, db)).keys());
}

/** Where one person stands here: the level held here, and whether the seat is kept and live (see the header). */
export interface StandingHere {
  kind: "anchor" | "membership";
  level: AccessLevel;
  kept: boolean;
  live: boolean;
}

/**
 * One person's standing here, a removed seat included, or null when they hold
 * no seat here at all (or have no account). The anchored workspace's own
 * stale membership row is never read as their seat.
 */
export async function standingHere(organizationId: string, userId: string, db: Db = prisma): Promise<StandingHere | null> {
  const u = await db.user.findUnique({ where: { id: userId }, select: { organizationId: true, accessLevel: true, status: true, deletedAt: true } });
  if (!u) return null;
  const account = { status: String(u.status), deletedAt: u.deletedAt };
  if (u.organizationId === organizationId) return { kind: "anchor", level: u.accessLevel, kept: anchoredAtReach(account, "kept"), live: anchoredAtReach(account, "live") };
  const m = await db.organizationMembership.findUnique({ where: { userId_organizationId: { userId, organizationId } }, select: { role: true, status: true, removedAt: true } });
  if (!m) return null;
  const seat = { status: String(m.status), removedAt: m.removedAt };
  return { kind: "membership", level: m.role, kept: membershipAtReach(seat, account, "kept"), live: membershipAtReach(seat, account, "live") };
}

/** One person's seat here at this reach, or null. */
export async function personHere(organizationId: string, id: string | null | undefined, reach: Reach, db: Db = prisma): Promise<PersonHere | null> {
  if (!id) return null;
  return (await peopleHereAmong(organizationId, [id], reach, db)).get(id) ?? null;
}

/**
 * The person with this email (any case) who holds a seat here at this reach:
 * someone anchored here first, then someone here through a membership (two
 * accounts can share an address across workspaces; the one anchored here is
 * this workspace's own). The earliest account first within each half.
 */
export async function personHereByEmail(organizationId: string, email: string, reach: Reach, db: Db = prisma): Promise<PersonHere | null> {
  const e = String(email ?? "").trim();
  if (!e) return null;
  const r = split(reach);
  const address = { email: { equals: e, mode: "insensitive" as const } };
  const anchored = await db.user.findFirst({ where: { ...anchoredHereWhere(organizationId, r.anchored), ...address }, select: PERSON_SELECT, orderBy: [{ createdAt: "asc" }, { id: "asc" }] });
  if (anchored) return { ...card(anchored), seat: anchoredSeat(anchored) };
  const m = await db.organizationMembership.findFirst({
    where: membershipHereWhere(organizationId, r.membership, address),
    select: { ...MEMBERSHIP_SELECT, user: { select: PERSON_SELECT } },
    orderBy: [{ createdAt: "asc" }, { userId: "asc" }],
  });
  return m?.user ? { ...card(m.user), seat: membershipSeat(m, m.user) } : null;
}

/**
 * The people with these exact addresses who hold a seat here at this reach,
 * one per address as personHereByEmail picks (anchored here first).
 */
export async function peopleHereByEmails(organizationId: string, emails: readonly string[], reach: Reach, db: Db = prisma): Promise<PersonHere[]> {
  const list = [...new Set(emails.filter((e) => typeof e === "string" && e.length > 0))];
  if (list.length === 0) return [];
  const r = split(reach);
  const anchored = await db.user.findMany({ where: { ...anchoredHereWhere(organizationId, r.anchored), email: { in: list } }, select: PERSON_SELECT });
  const found = new Map<string, PersonHere>();
  for (const u of anchored) if (!found.has(u.email)) found.set(u.email, { ...card(u), seat: anchoredSeat(u) });
  const left = list.filter((e) => !found.has(e));
  if (left.length > 0) {
    const seats = await db.organizationMembership.findMany({
      where: membershipHereWhere(organizationId, r.membership, { email: { in: left } }),
      select: { ...MEMBERSHIP_SELECT, user: { select: PERSON_SELECT } },
      orderBy: [{ createdAt: "asc" }, { userId: "asc" }],
    });
    for (const m of seats) if (m.user && !found.has(m.user.email)) found.set(m.user.email, { ...card(m.user), seat: membershipSeat(m, m.user) });
  }
  return [...found.values()];
}

/** Names in the order Postgres's collation gives them, near enough (as the Directory compares them). */
const NAMES = new Intl.Collator(undefined, { sensitivity: "base", numeric: true });

/** A people list's order: first name, then last name, then id (by code point). */
export function byName(order: "asc" | "desc" = "asc") {
  const sign = order === "desc" ? -1 : 1;
  return (a: { id: string; firstName: string; lastName: string }, b: { id: string; firstName: string; lastName: string }): number =>
    sign * NAMES.compare(a.firstName ?? "", b.firstName ?? "") || sign * NAMES.compare(a.lastName ?? "", b.lastName ?? "") || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
}

/**
 * Two lists, each already in `cmp` order, merged in that order. The first k
 * of the answer read at most k of each list, so a page cut from a merge of
 * each half's first (skip + take) rows is the same page however the halves
 * were cut.
 */
export function mergeOrdered<T>(a: readonly T[], b: readonly T[], cmp: (x: T, y: T) => number): T[] {
  const out: T[] = [];
  let i = 0;
  let j = 0;
  while (i < a.length && j < b.length) out.push(cmp(a[i], b[j]) <= 0 ? a[i++] : b[j++]);
  while (i < a.length) out.push(a[i++]);
  while (j < b.length) out.push(b[j++]);
  return out;
}

export interface PeopleByNameQuery {
  organizationId: string;
  reach: Reach;
  /** Conditions on the person, for both halves (search words, id lists). */
  person?: Prisma.UserWhereInput[];
  /** Leave out anyone at the Agent tier here (an Agent is never anyone's manager, access 2.4). */
  noAgents?: boolean;
  /** Only people whose seat here is in one of these departments (this workspace's ids). */
  departmentIn?: readonly string[];
  take: number;
  skip?: number;
  order?: "asc" | "desc";
  db?: Db;
}

/**
 * Everyone with a seat here at this reach who matches `person`, in name
 * order, each with their seat here: the two halves, each read by name in the
 * database (first name, last name, id) up to skip + take, then merged
 * (mergeOrdered) and cut.
 */
export async function peopleHereByName(q: PeopleByNameQuery): Promise<PersonHere[]> {
  const db = q.db ?? prisma;
  const r = split(q.reach);
  const order = q.order ?? "asc";
  const skip = Math.max(0, q.skip ?? 0);
  const upTo = skip + Math.max(0, q.take);
  if (upTo === 0) return [];
  const person = q.person ?? [];
  const dept = q.departmentIn ? { departmentId: { in: [...q.departmentIn] } } : {};
  const [anchored, members] = await Promise.all([
    db.user.findMany({
      where: {
        ...anchoredHereWhere(q.organizationId, r.anchored),
        ...(q.noAgents ? { accessLevel: { not: "AGENT" as const } } : {}),
        ...dept,
        ...(person.length > 0 ? { AND: person } : {}),
      },
      select: PERSON_SELECT,
      orderBy: [{ firstName: order }, { lastName: order }, { id: "asc" }],
      take: upTo,
    }),
    db.organizationMembership.findMany({
      where: {
        ...membershipHereWhere(q.organizationId, r.membership, person.length > 0 ? { AND: person } : {}),
        ...(q.noAgents ? { role: { not: "AGENT" as const } } : {}),
        ...dept,
      },
      select: { ...MEMBERSHIP_SELECT, user: { select: PERSON_SELECT } },
      orderBy: [{ user: { firstName: order } }, { user: { lastName: order } }, { userId: "asc" }],
      take: upTo,
    }),
  ]);
  const a: PersonHere[] = anchored.map((u) => ({ ...card(u), seat: anchoredSeat(u) }));
  const b: PersonHere[] = members.filter((m) => !!m.user).map((m) => ({ ...card(m.user!), seat: membershipSeat(m, m.user!) }));
  return mergeOrdered(a, b, byName(order)).slice(skip, upTo);
}

/** How many people hold a seat here at this reach and match `person` (the two halves counted). */
export async function countPeopleHere(q: Omit<PeopleByNameQuery, "take" | "skip" | "order">): Promise<number> {
  const db = q.db ?? prisma;
  const r = split(q.reach);
  const person = q.person ?? [];
  const dept = q.departmentIn ? { departmentId: { in: [...q.departmentIn] } } : {};
  const [a, b] = await Promise.all([
    db.user.count({ where: { ...anchoredHereWhere(q.organizationId, r.anchored), ...(q.noAgents ? { accessLevel: { not: "AGENT" as const } } : {}), ...dept, ...(person.length > 0 ? { AND: person } : {}) } }),
    db.organizationMembership.count({ where: { ...membershipHereWhere(q.organizationId, r.membership, person.length > 0 ? { AND: person } : {}), ...(q.noAgents ? { role: { not: "AGENT" as const } } : {}), ...dept } }),
  ]);
  return a + b;
}

/**
 * Every id with a seat here at this reach (no order), the two halves: for a
 * caller that writes to the whole workspace at once (the #general seed).
 */
export async function everyoneHereIds(organizationId: string, reach: Reach, db: Db = prisma): Promise<string[]> {
  const r = split(reach);
  const [a, b] = await Promise.all([
    db.user.findMany({ where: anchoredHereWhere(organizationId, r.anchored), select: { id: true } }),
    db.organizationMembership.findMany({ where: membershipHereWhere(organizationId, r.membership), select: { userId: true } }),
  ]);
  return [...new Set([...a.map((u) => u.id), ...b.map((m) => m.userId)])];
}

/** The workspace's Owners and Admins at the level held here, at this reach. */
export async function adminsHereIds(organizationId: string, reach: Reach, db: Db = prisma): Promise<string[]> {
  const r = split(reach);
  const admin = { in: ["SUPER_ADMIN", "COMPANY_ADMIN"] as AccessLevel[] };
  const [a, b] = await Promise.all([
    db.user.findMany({ where: { ...anchoredHereWhere(organizationId, r.anchored), accessLevel: admin }, select: { id: true } }),
    db.organizationMembership.findMany({ where: { ...membershipHereWhere(organizationId, r.membership), role: admin }, select: { userId: true } }),
  ]);
  return [...new Set([...a.map((u) => u.id), ...b.map((m) => m.userId)])];
}

/**
 * The people a Guest here may find: the people they share a conversation
 * with in this workspace (access 11 invariant 3, "Guests see only what is
 * shared with them"), never the staff list. One rule for every finder of
 * people: the pickers (people/pick), the people search of Ask AI and MCP
 * (searchEmployeeRows) and the command palette (/api/search, the step 6
 * review M4).
 */
export async function guestConversationPartnerIds(organizationId: string, guestId: string, db: Db = prisma): Promise<string[]> {
  const shared = await db.conversationMember.findMany({
    where: { conversation: { organizationId, members: { some: { userId: guestId } } } },
    select: { userId: true },
    take: 500,
  });
  return [...new Set(shared.map((r) => r.userId))];
}

/** A person's own weekly hours and working week here (people data: the caller decides who may read them). */
export interface CapacityHere {
  weeklyCapacityHours: number | null;
  /** The stored override, unparsed; none means this workspace's calendar. */
  workSchedule: unknown;
}

/**
 * The weekly hours and working week each of these people gives THIS
 * workspace (E13): the account's for someone anchored here, the
 * membership's for anyone else (none means this workspace's calendar),
 * never another workspace's. Two reads at most. Callers tolerate the
 * columns being absent, as before.
 */
export async function capacityHereOf(organizationId: string, ids: readonly string[], db: Db = prisma): Promise<Map<string, CapacityHere>> {
  const want = [...new Set(ids)].filter(Boolean);
  const out = new Map<string, CapacityHere>();
  if (want.length === 0) return out;
  const users = await db.user.findMany({ where: { id: { in: want } }, select: { id: true, organizationId: true, weeklyCapacityHours: true, workSchedule: true } });
  const elsewhere: string[] = [];
  for (const u of users) {
    if (u.organizationId === organizationId) out.set(u.id, { weeklyCapacityHours: u.weeklyCapacityHours ?? null, workSchedule: u.workSchedule ?? null });
    else elsewhere.push(u.id);
  }
  if (elsewhere.length > 0) {
    const seats = await db.organizationMembership.findMany({ where: { organizationId, userId: { in: elsewhere } }, select: { userId: true, weeklyCapacityHours: true, workSchedule: true } });
    for (const m of seats) out.set(m.userId, { weeklyCapacityHours: m.weeklyCapacityHours ?? null, workSchedule: m.workSchedule ?? null });
  }
  return out;
}
