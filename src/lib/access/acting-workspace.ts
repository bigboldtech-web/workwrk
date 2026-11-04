// The workspace a signed-in session acts in, and the level it holds there.
//
// A person can belong to several workspaces. User.organizationId is only the
// one they are anchored to: the last one they switched to, on any device. A
// token on another device keeps acting in the workspace it was in for as long
// as that workspace is healthy and the person still holds a membership there
// (the jwt revalidation, src/lib/auth.ts). Every read of "the viewer" has to
// follow that same rule, or one device opens a doc in one workspace and its
// sharing dialog, block comments or uploads in another.
//
// Read fresh from the database, so a stale token never widens anyone: the
// anchored workspace at User.accessLevel, or the session's own workspace at
// the role its membership holds now, never the anchor's level there. With no
// membership in the session's workspace, the anchored one.
//
// AN ENDED MEMBERSHIP IS NO MEMBERSHIP (docs/plans/workspace-status.md D7,
// D12). A membership carries the person's status in that workspace: a
// deactivated or removed one (workspace-seat.ts seatIsLive) gives no acting
// workspace and no level there, exactly as a missing row. inWorkspaceWhere
// leaves out both by default, and keeps a deactivated one for a caller that
// keeps deactivated people anchored here (`deactivatedToo`).
// workspacePeopleLines and workspaceDottedLines leave out a removed
// membership always, and a deactivated one wherever they leave out a
// deactivated account (`activeOnly`). A person anchored here keeps the rules
// of their own row (User.status, User.deletedAt), unchanged.
//
// THE LINE HERE IS THE SEAT'S (docs/plans/workspace-status-2.md E1, E2,
// step 1). A person's manager in a workspace is held by the row that holds
// their seat there: User.managerId for someone anchored there, the
// membership's own managerId for anyone else, never the anchored
// workspace's own stale membership row. Each dotted line names its
// workspace (UserDottedLine.organizationId). So seatsHeldFor and
// personSeatIn answer the line with the seat, reportsHereOf answers who
// reports to someone here (both halves, by their indexes), and the two
// workspace-wide reads below take each person's line and dotted lines here.

import type { AccessLevel, Prisma, PrismaClient } from "@/generated/prisma";
import { prisma } from "@/lib/prisma";
import { effectiveOrgRole, isAgentOf } from "./org-role";
import { ENDED_STATUS, keptSeatSql, keptSeatWhere, liveSeatSql, liveSeatWhere, seatIsKept, seatIsLive } from "./workspace-seat";
import { anchoredHereWhere, membershipHereWhere } from "./seated-here";

type Db = PrismaClient | Prisma.TransactionClient;

export interface ActingWorkspace {
  organizationId: string;
  accessLevel: AccessLevel;
}

export async function actingWorkspace(
  user: { id: string; organizationId: string; accessLevel: AccessLevel },
  sessionOrganizationId: string | null | undefined,
): Promise<ActingWorkspace> {
  if (sessionOrganizationId && sessionOrganizationId !== user.organizationId) {
    const held = await prisma.organizationMembership.findUnique({
      where: { userId_organizationId: { userId: user.id, organizationId: sessionOrganizationId } },
      select: { role: true, status: true, removedAt: true },
    });
    // An ended seat there is no seat (D7): the anchored workspace, as with none.
    if (held && seatIsLive(held)) return { organizationId: sessionOrganizationId, accessLevel: held.role };
  }
  return { organizationId: user.organizationId, accessLevel: user.accessLevel };
}

/**
 * The level a person holds in ONE workspace, read fresh: their own level
 * where they are anchored, the role their membership there holds anywhere
 * else, and null where they hold neither (a deactivated or removed
 * membership holds nothing, D7). Never the anchored workspace's
 * level in another one: a person who is an Admin of a workspace they just
 * created, and works in a company where they are a Member, is a Member there.
 * Pass the anchored row when the caller already read it, and `db` when the
 * read must run inside the caller's transaction. `keptSeats` also answers
 * through a deactivated membership (never a removed one), for a walk of the
 * lines that keeps deactivated people as it does those anchored here (the
 * loop walk); never for a decision about the person's own access (see
 * levelsHeldFor).
 */
export async function levelHeldIn(
  userId: string,
  organizationId: string,
  anchored?: { organizationId: string; accessLevel: AccessLevel } | null,
  db: Db = prisma,
  opts: { keptSeats?: boolean } = {},
): Promise<AccessLevel | null> {
  const row = anchored ?? (await db.user.findUnique({ where: { id: userId }, select: { organizationId: true, accessLevel: true } }));
  if (!row) return null;
  if (row.organizationId === organizationId) return row.accessLevel;
  const held = await db.organizationMembership.findUnique({
    where: { userId_organizationId: { userId, organizationId } },
    select: { role: true, status: true, removedAt: true },
  });
  if (!held) return null;
  return (opts.keptSeats ? seatIsKept(held) : seatIsLive(held)) ? held.role : null;
}

/**
 * The Prisma `where` for "holds a level in this workspace" (anchored here, or
 * a live membership here), for a single query that must stay one (a count, a
 * first match). Spread it where the `where` has no OR of its own.
 *
 * A deactivated or removed membership counts as none (D7, D12). The anchored
 * half is the row alone: the caller states its own User.deletedAt and
 * User.status conditions, which hold for both halves. `deactivatedToo` keeps
 * a deactivated membership in, for a caller that keeps deactivated people
 * anchored here (it filters deletedAt only): a removed one stays out, as a
 * removed anchored row does. The callers that pass it, and why, are listed in
 * src/lib/access/workspace-status.test.ts.
 *
 * ONLY where the query is already narrowed by an indexed column (id,
 * managerId, a dotted line's userId or managerId). The OR with its membership
 * sublink cannot use an index, so as a query's only selective filter it read
 * every User row of every workspace (docs-found fixes batch 6): a read of a
 * whole workspace's people goes through workspacePeopleLines or
 * workspaceDottedLines instead.
 */
export function inWorkspaceWhere(organizationId: string, opts: { deactivatedToo?: boolean } = {}): { OR: Prisma.UserWhereInput[] } {
  const seat = opts.deactivatedToo ? keptSeatWhere() : liveSeatWhere();
  return { OR: [{ organizationId }, { organizationMemberships: { some: { organizationId, ...seat } } }] };
}

/** One person who holds a level in a workspace, and their manager there (the line their seat's row holds). */
export interface WorkspacePersonLine {
  id: string;
  managerId: string | null;
}

/**
 * Everyone who holds a level in this workspace and is not removed, with
 * their manager HERE: anchored here, the line on their account row; or a
 * membership here that is not removed, the line on that membership
 * (docs-found fixes batch 6; D12; workspace-status-2.md E1). One statement,
 * two indexed halves:
 *
 *   anchored here       "User" by "User_organizationId_idx"
 *   a membership here   "OrganizationMembership" by
 *                       "OrganizationMembership_organizationId_idx", each
 *                       person then by "User_pkey"
 *
 * The second half leaves out the people anchored here, so UNION ALL answers
 * each person once (a membership is unique per person and workspace) with no
 * sort to drop duplicates. `activeOnly` leaves deactivated people out too:
 * a deactivated account, and a deactivated membership here.
 */
export async function workspacePeopleLines(organizationId: string, opts: { activeOnly?: boolean } = {}, db: Db = prisma): Promise<WorkspacePersonLine[]> {
  if (opts.activeOnly) {
    return db.$queryRaw<WorkspacePersonLine[]>`
      SELECT u."id", u."managerId"
        FROM "User" u
       WHERE u."organizationId" = ${organizationId}
         AND u."deletedAt" IS NULL
         AND u."status" <> 'INACTIVE'
      UNION ALL
      SELECT u."id", m."managerId"
        FROM "OrganizationMembership" m
        JOIN "User" u ON u."id" = m."userId"
       WHERE m."organizationId" = ${organizationId}
         AND u."organizationId" <> ${organizationId}
         AND u."deletedAt" IS NULL
         AND u."status" <> 'INACTIVE'
         AND ${liveSeatSql("m")}`;
  }
  return db.$queryRaw<WorkspacePersonLine[]>`
    SELECT u."id", u."managerId"
      FROM "User" u
     WHERE u."organizationId" = ${organizationId}
       AND u."deletedAt" IS NULL
    UNION ALL
    SELECT u."id", m."managerId"
      FROM "OrganizationMembership" m
      JOIN "User" u ON u."id" = m."userId"
     WHERE m."organizationId" = ${organizationId}
       AND u."organizationId" <> ${organizationId}
       AND u."deletedAt" IS NULL
       AND ${keptSeatSql("m")}`;
}

/**
 * Every dotted line OF THIS WORKSPACE (UserDottedLine.organizationId, E2)
 * from someone who holds a level here and is not removed (the dotted-lines
 * loop walk): a deactivated person's lines count, anchored here or through
 * a membership here, as a loop through them is still a loop. Another
 * workspace's lines of the same person are never read (E5: each
 * workspace's lines are their own graph). The same two indexed halves as
 * workspacePeopleLines, each joined to "UserDottedLine" by
 * "UserDottedLine_organizationId_userId_idx".
 */
export async function workspaceDottedLines(organizationId: string, db: Db = prisma): Promise<Array<{ userId: string; managerId: string }>> {
  return db.$queryRaw<Array<{ userId: string; managerId: string }>>`
    SELECT d."userId", d."managerId"
      FROM "User" u
      JOIN "UserDottedLine" d ON d."userId" = u."id" AND d."organizationId" = ${organizationId}
     WHERE u."organizationId" = ${organizationId}
       AND u."deletedAt" IS NULL
    UNION ALL
    SELECT d."userId", d."managerId"
      FROM "OrganizationMembership" m
      JOIN "User" u ON u."id" = m."userId"
      JOIN "UserDottedLine" d ON d."userId" = u."id" AND d."organizationId" = ${organizationId}
     WHERE m."organizationId" = ${organizationId}
       AND u."organizationId" <> ${organizationId}
       AND u."deletedAt" IS NULL
       AND ${keptSeatSql("m")}`;
}

/**
 * levelHeldIn for many people at once, in at most two reads: the level each
 * holds in this one workspace. Absent from the answer: anyone who holds
 * neither a row anchored here nor a live membership here (or has no row). The
 * membership read runs only for people anchored somewhere else. `keptSeats`
 * as levelsHeldFor.
 */
export async function levelsHeldIn(
  organizationId: string,
  userIds: readonly string[],
  db: Db = prisma,
  opts: { keptSeats?: boolean } = {},
): Promise<Map<string, AccessLevel>> {
  const ids = [...new Set(userIds)].filter(Boolean);
  if (ids.length === 0) return new Map();
  const rows = await db.user.findMany({ where: { id: { in: ids } }, select: { id: true, organizationId: true, accessLevel: true } });
  return levelsHeldFor(organizationId, rows, db, opts);
}

/** The memberships here of people anchored somewhere else, with their seat and their line here. */
async function membershipSeatsHere(organizationId: string, userIds: readonly string[], db: Db) {
  if (userIds.length === 0) return [];
  return db.organizationMembership.findMany({
    where: { organizationId, userId: { in: [...new Set(userIds)] } },
    select: { userId: true, role: true, status: true, removedAt: true, managerId: true },
  });
}

/**
 * levelsHeldIn for rows the caller already read (each with its anchored
 * workspace and level), in at most one more read: the memberships of the
 * people anchored somewhere else. THE answer to "is this person in this
 * workspace, and at what level" for every read of reporting lines and the
 * people they count (docs-found fixes batch 5): User.organizationId is only
 * the workspace a person last switched to, on any device, so "anchored here"
 * alone drops everyone who works here and was last somewhere else. A
 * deactivated or removed membership holds no level (D7), as in levelHeldIn.
 *
 * `keptSeats` (step 1 review, M2) keeps a DEACTIVATED membership in (never a
 * removed one): for the reads that keep deactivated people anchored here,
 * since an anchored row answers whatever its status. Those are the counts
 * and line facts of people not removed (reportCountOf, lineFactsAround,
 * effectiveDirectReportIds, liveHereAmong), the Agent tier, the loop walk and
 * who a record or a list names. A decision about the person's own access,
 * or the reach and the ownership of a line, keeps the default: a seat ended
 * here is no one here. Every caller and its choice is listed in
 * src/lib/access/kept-seats.test.ts. seatsHeldFor also says which seats are
 * deactivated.
 */
export async function levelsHeldFor(
  organizationId: string,
  rows: ReadonlyArray<{ id: string; organizationId: string; accessLevel: AccessLevel }>,
  db: Db = prisma,
  opts: { keptSeats?: boolean } = {},
): Promise<Map<string, AccessLevel>> {
  const out = new Map<string, AccessLevel>();
  const elsewhere: string[] = [];
  for (const r of rows) {
    if (r.organizationId === organizationId) out.set(r.id, r.accessLevel);
    else elsewhere.push(r.id);
  }
  for (const h of await membershipSeatsHere(organizationId, elsewhere, db)) {
    if (opts.keptSeats ? seatIsKept(h) : seatIsLive(h)) out.set(h.userId, h.role);
  }
  return out;
}

/** A seat a person holds here, not removed: the level, whether it is deactivated here, and their manager here. */
export interface HeldSeat {
  level: AccessLevel;
  deactivated: boolean;
  /**
   * Their manager in THIS workspace (workspace-status-2.md E1): the
   * account's line for someone anchored here, the membership's for anyone
   * else. Never the anchored workspace's line read in another workspace.
   */
  managerId: string | null;
}

/**
 * levelsHeldFor with kept seats, and for each whether the seat is
 * deactivated HERE: for someone anchored here their own row's status, for
 * someone working here through a membership that membership's status, never
 * their account's (User.status is the anchored workspace's, D1). Someone live
 * in A and deactivated in B reads as deactivated in B. The line here comes
 * with it the same way (`managerId`, E1): each row passes the account's own
 * line, which is the answer only where the account is anchored here.
 */
export async function seatsHeldFor(
  organizationId: string,
  rows: ReadonlyArray<{ id: string; organizationId: string; accessLevel: AccessLevel; status: string; managerId: string | null }>,
  db: Db = prisma,
): Promise<Map<string, HeldSeat>> {
  const out = new Map<string, HeldSeat>();
  const elsewhere: string[] = [];
  for (const r of rows) {
    if (r.organizationId === organizationId) out.set(r.id, { level: r.accessLevel, deactivated: r.status === ENDED_STATUS, managerId: r.managerId ?? null });
    else elsewhere.push(r.id);
  }
  for (const h of await membershipSeatsHere(organizationId, elsewhere, db)) {
    if (seatIsKept(h)) out.set(h.userId, { level: h.role, deactivated: h.status === ENDED_STATUS, managerId: h.managerId ?? null });
  }
  return out;
}

/**
 * The line each of these people holds HERE (E1, step 2): for everyone with
 * a seat here not removed (seatsHeldFor's kept seats), the account's line
 * for someone anchored here and the membership's otherwise. Someone with no
 * seat here, or a removed one, is absent, so "no line here" is a null
 * answer, never a missing one.
 */
export async function linesHereOf(organizationId: string, ids: readonly string[], db: Db = prisma): Promise<Map<string, string | null>> {
  const want = [...new Set(ids)].filter(Boolean);
  if (want.length === 0) return new Map();
  const rows = await db.user.findMany({ where: { id: { in: want } }, select: { id: true, organizationId: true, accessLevel: true, status: true, managerId: true } });
  return new Map([...(await seatsHeldFor(organizationId, rows, db))].map(([id, seat]) => [id, seat.managerId]));
}

/** Someone who reports to one of the managers asked about, in this workspace (reportsHereOf). */
export interface ReportHere {
  id: string;
  /** The manager they report to here. */
  managerId: string;
  /** Which row holds their line here: their account (anchored here) or their membership. */
  kind: "anchor" | "membership";
  /** The level they hold here: their account's where anchored here, their membership's role otherwise (the Agent tier, for a walk). */
  level: AccessLevel;
  /** Deactivated here: their account's status where anchored here, their membership's otherwise. */
  deactivated: boolean;
}

/**
 * Who reports to these managers IN THIS WORKSPACE (workspace-status-2.md E1,
 * step 1): the people anchored here whose account line names one of them,
 * and the people here through a membership whose membership line names one
 * of them. Never the cross-workspace `directReports` relation, which names
 * every account whose own line names the manager, in any workspace; and
 * never the anchored workspace's own stale membership row (the membership
 * half leaves out the people anchored here).
 *
 * Two indexed halves, never one OR with a membership sublink:
 *   anchored here       "User" by "User_managerId_idx", then its workspace
 *   a membership here   "OrganizationMembership" by
 *                       "OrganizationMembership_managerId_organizationId_idx"
 *                       (both columns equalities), each person then by
 *                       "User_pkey"
 *
 * `seats`: "kept" by default, every report not removed here (a deactivated
 * one included, as the line facts and the handover keep them); "live" for
 * a reader that leaves deactivated people out (seated-here.ts reaches: a
 * live membership also needs its account not ended, D12). Each answer once,
 * in id order.
 */
export async function reportsHereOf(
  organizationId: string,
  managerIds: readonly string[],
  db: Db = prisma,
  opts: { seats?: "kept" | "live" } = {},
): Promise<ReportHere[]> {
  const ids = [...new Set(managerIds)].filter(Boolean);
  if (ids.length === 0) return [];
  const reach = opts.seats ?? "kept";
  const [anchored, members] = await Promise.all([
    db.user.findMany({ where: { managerId: { in: ids }, ...anchoredHereWhere(organizationId, reach) }, select: { id: true, managerId: true, status: true, accessLevel: true } }),
    db.organizationMembership.findMany({ where: { managerId: { in: ids }, ...membershipHereWhere(organizationId, reach) }, select: { userId: true, managerId: true, status: true, role: true } }),
  ]);
  const out = new Map<string, ReportHere>();
  for (const u of anchored) {
    if (u.managerId) out.set(u.id, { id: u.id, managerId: u.managerId, kind: "anchor", level: u.accessLevel, deactivated: String(u.status) === ENDED_STATUS });
  }
  for (const m of members) {
    if (m.managerId && !out.has(m.userId)) out.set(m.userId, { id: m.userId, managerId: m.managerId, kind: "membership", level: m.role, deactivated: String(m.status) === ENDED_STATUS });
  }
  return [...out.values()].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}

/**
 * A person's seat in ONE workspace whatever its state, a removed one
 * included, for the routes that act on it (the person's admin routes, the
 * handover; docs/plans/workspace-status.md D11): which row holds it, the
 * level, the status and the removal there. "anchor": they are anchored here,
 * so the account row holds it (User.accessLevel, status, deletedAt).
 * "membership": they work here through a membership, which holds it (role,
 * status, removedAt, D1); the account's own profile (department, job
 * title and the rest) is then the anchored workspace's, and the one this
 * workspace holds is the membership's (D18): `placement`, its department,
 * office and job role ids, read with the seat. The line here rides on the
 * same row (workspace-status-2.md E1): `managerId`.
 */
export interface PersonSeat {
  kind: "anchor" | "membership";
  level: AccessLevel;
  status: string;
  removedAt: Date | null;
  adminScopes: string[];
  /** Their manager in THIS workspace: User.managerId when anchored here, the membership's otherwise (E1). */
  managerId: string | null;
  /** For a membership seat: the department, office and job role ids it holds here (D18). */
  placement?: { departmentId: string | null; officeId: string | null; roleId: string | null };
}

/**
 * The seat a person holds in this workspace (PersonSeat), or null when they
 * hold none here (or have no account). Pass the account row when the caller
 * read it. The anchored workspace's own stale membership row is never read
 * as its seat, nor its line. A row passed without `managerId` costs one more
 * read for someone anchored here, so the line is never guessed.
 */
export async function personSeatIn(
  organizationId: string,
  userId: string,
  db: Db = prisma,
  row?: { organizationId: string; accessLevel: AccessLevel; status: string; deletedAt: Date | null; adminScopes?: string[] | null; managerId?: string | null } | null,
): Promise<PersonSeat | null> {
  const user = row ?? (await db.user.findUnique({ where: { id: userId }, select: { organizationId: true, accessLevel: true, status: true, deletedAt: true, adminScopes: true, managerId: true } }));
  if (!user) return null;
  if (user.organizationId === organizationId) {
    const managerId = user.managerId !== undefined ? user.managerId : ((await db.user.findUnique({ where: { id: userId }, select: { managerId: true } }))?.managerId ?? null);
    return { kind: "anchor", level: user.accessLevel, status: String(user.status), removedAt: user.deletedAt, adminScopes: user.adminScopes ?? [], managerId: managerId ?? null };
  }
  const m = await db.organizationMembership.findUnique({
    where: { userId_organizationId: { userId, organizationId } },
    select: { role: true, status: true, removedAt: true, adminScopes: true, departmentId: true, officeId: true, roleId: true, managerId: true },
  });
  return m
    ? {
        kind: "membership",
        level: m.role,
        status: String(m.status),
        removedAt: m.removedAt,
        adminScopes: m.adminScopes ?? [],
        managerId: m.managerId ?? null,
        placement: { departmentId: m.departmentId ?? null, officeId: m.officeId ?? null, roleId: m.roleId ?? null },
      }
    : null;
}

/** A stored reporting line: the person it is stored on, and the manager it names (User.managerId, or a UserDottedLine). */
export interface StoredLine {
  personId: string;
  managerId: string;
}

/** The key linesElsewhere answers a line by. */
export function lineKey(line: StoredLine): string {
  return `${line.personId}\n${line.managerId}`;
}

/** How one stored line stands in the other workspaces its person works in, and which of them rely on it. */
export interface LineThere {
  standing: "relied" | "shared";
  /** The other workspaces where the line is "relied" (empty for "shared"). */
  reliedIn: string[];
}

/**
 * How each of these stored lines stands in the OTHER workspaces its person
 * works in (docs-found fixes batch 6). User.managerId and UserDottedLine are
 * one row each, read by every workspace the person belongs to, so a
 * workspace rewrites or clears only the lines it owns: those no other
 * workspace relies on.
 *
 *   "relied"   the person works in another workspace too (anchored there, or
 *              a membership there) and the manager holds a level there that
 *              is not the Agent tier: there, the person reports to them
 *   "shared"   the manager holds a level in another workspace the person
 *              works in, only ever the Agent tier
 *
 * A line in neither is absent from the answer. So is a line to a manager no
 * workspace treats as one (batch 7): a removed or deactivated account (a
 * deactivated person holds no reports, invariant 13; both are one column, so
 * that is true in every workspace), or a Guest there (anchored there with
 * GUEST as their stored role: a Guest reads no one's people data and is no
 * one's digest manager). A Guest in one workspace who manages in another is
 * answered by the other.
 *
 * `leaving` is for the handover and the step that ends an account only: its
 * leaver is being deactivated or removed right now, or already was (SCIM
 * deactivates them just before the handover runs, and a handover can run
 * after a removal), and the line the other workspace relied on until then
 * moves, with its record written there. So a deactivated or removed manager
 * is not left out for it (docs-found fixes batch 8: a removed one was, so a
 * handover after a removal wrote that workspace no record). A caller that
 * must leave out removed accounts reads the row's deletedAt itself
 * (manager-candidate.ts staleLinesOf).
 *
 * At most four indexed reads ("User_pkey", "OrganizationMembership_userId_idx"),
 * and two when nobody among them works anywhere else, which is most people.
 *
 * THE SEAT THERE (docs/plans/workspace-status.md D12). The person works in
 * another workspace through a membership while that seat is kept: a
 * deactivated one still counts (that workspace may reactivate them, and a
 * deactivated person anchored there counts too), a removed one does not (that
 * workspace let them go; a restore there asks about its lines again,
 * manager-candidate.ts staleLinesOf). The manager holds a level there through
 * a membership only while that seat is live, as a deactivated or removed
 * account holds none (batch 7), unless the manager is the one leaving
 * (`leaving`), whose seat there is read whatever its state, as their account
 * is. Before, any membership row counted on both sides, so a line stayed
 * "relied" on in a workspace that had ended the person or the manager.
 */
export async function lineStandingsElsewhere(
  organizationId: string,
  lines: readonly StoredLine[],
  db: Db = prisma,
  opts: { leaving?: boolean } = {},
): Promise<Map<string, LineThere>> {
  const out = new Map<string, LineThere>();
  const persons = [...new Set(lines.map((l) => l.personId))].filter(Boolean);
  if (persons.length === 0) return out;
  const [personRows, personMemberships] = await Promise.all([
    db.user.findMany({ where: { id: { in: persons } }, select: { id: true, organizationId: true } }),
    db.organizationMembership.findMany({ where: { userId: { in: persons }, organizationId: { not: organizationId }, ...keptSeatWhere() }, select: { userId: true, organizationId: true } }),
  ]);
  // The other workspaces each person works in.
  const others = new Map<string, Set<string>>();
  const note = (personId: string, org: string | null | undefined) => {
    if (!org || org === organizationId) return;
    const set = others.get(personId) ?? new Set<string>();
    set.add(org);
    others.set(personId, set);
  };
  for (const r of personRows) note(r.id, r.organizationId);
  for (const m of personMemberships) note(m.userId, m.organizationId);
  if (others.size === 0) return out;
  const wanted = lines.filter((l) => others.has(l.personId));
  const managers = [...new Set(wanted.map((l) => l.managerId))];
  const orgs = [...new Set([...others.values()].flatMap((s) => [...s]))];
  const [managerRows, managerMemberships] = await Promise.all([
    db.user.findMany({ where: { id: { in: managers } }, select: { id: true, organizationId: true, accessLevel: true, status: true, deletedAt: true, orgRole: true } }),
    db.organizationMembership.findMany({
      where: { userId: { in: managers }, organizationId: { in: orgs }, ...(opts.leaving ? {} : liveSeatWhere()) },
      select: { userId: true, organizationId: true, role: true },
    }),
  ]);
  // A manager no workspace treats as one answers nothing (batch 7), unless
  // their account is the one ending (`leaving`).
  const live = new Map(managerRows.filter((r) => opts.leaving || (!r.deletedAt && r.status !== "INACTIVE")).map((r) => [r.id, r]));
  const levelIn = (managerId: string, org: string): AccessLevel | null => {
    const row = live.get(managerId);
    if (!row) return null;
    if (row.organizationId === org) {
      // A Guest there: their level mirrors a Member's, their stored role says GUEST.
      return effectiveOrgRole(row.accessLevel, false, row.orgRole) === "GUEST" ? null : row.accessLevel;
    }
    const role = managerMemberships.find((m) => m.userId === managerId && m.organizationId === org)?.role ?? null;
    return role && effectiveOrgRole(role, false, null) !== "GUEST" ? role : null;
  };
  for (const line of wanted) {
    const held = [...(others.get(line.personId) ?? [])]
      .map((org) => ({ org, level: levelIn(line.managerId, org) }))
      .filter((h): h is { org: string; level: AccessLevel } => h.level !== null);
    const reliedIn = held.filter((h) => !isAgentOf(h.level)).map((h) => h.org);
    if (reliedIn.length > 0) out.set(lineKey(line), { standing: "relied", reliedIn });
    else if (held.length > 0) out.set(lineKey(line), { standing: "shared", reliedIn: [] });
  }
  return out;
}

/** lineStandingsElsewhere's standing alone, by lineKey: what every write that must leave another workspace's line asks. */
export async function linesElsewhere(organizationId: string, lines: readonly StoredLine[], db: Db = prisma): Promise<Map<string, "relied" | "shared">> {
  const there = await lineStandingsElsewhere(organizationId, lines, db);
  return new Map([...there].map(([key, t]) => [key, t.standing]));
}
