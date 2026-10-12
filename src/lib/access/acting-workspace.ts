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

import type { AccessLevel, Prisma, PrismaClient } from "@/generated/prisma";
import { prisma } from "@/lib/prisma";
import { effectiveOrgRole, isAgentOf } from "./org-role";

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
      select: { role: true },
    });
    if (held) return { organizationId: sessionOrganizationId, accessLevel: held.role };
  }
  return { organizationId: user.organizationId, accessLevel: user.accessLevel };
}

/**
 * The level a person holds in ONE workspace, read fresh: their own level
 * where they are anchored, the role their membership there holds anywhere
 * else, and null where they hold neither. Never the anchored workspace's
 * level in another one: a person who is an Admin of a workspace they just
 * created, and works in a company where they are a Member, is a Member there.
 * Pass the anchored row when the caller already read it, and `db` when the
 * read must run inside the caller's transaction.
 */
export async function levelHeldIn(
  userId: string,
  organizationId: string,
  anchored?: { organizationId: string; accessLevel: AccessLevel } | null,
  db: Db = prisma,
): Promise<AccessLevel | null> {
  const row = anchored ?? (await db.user.findUnique({ where: { id: userId }, select: { organizationId: true, accessLevel: true } }));
  if (!row) return null;
  if (row.organizationId === organizationId) return row.accessLevel;
  const held = await db.organizationMembership.findUnique({
    where: { userId_organizationId: { userId, organizationId } },
    select: { role: true },
  });
  return held?.role ?? null;
}

/**
 * The Prisma `where` for "holds a level in this workspace" (anchored here, or
 * a membership here), for a single query that must stay one (a count, a
 * first match). Spread it where the `where` has no OR of its own.
 *
 * ONLY where the query is already narrowed by an indexed column (id,
 * managerId, a dotted line's userId or managerId). The OR with its membership
 * sublink cannot use an index, so as a query's only selective filter it read
 * every User row of every workspace (docs-found fixes batch 6): a read of a
 * whole workspace's people goes through workspacePeopleLines or
 * workspaceDottedLines instead.
 */
export function inWorkspaceWhere(organizationId: string): { OR: Prisma.UserWhereInput[] } {
  return { OR: [{ organizationId }, { organizationMemberships: { some: { organizationId } } }] };
}

/** One person who holds a level in a workspace, and the manager stored on their row. */
export interface WorkspacePersonLine {
  id: string;
  managerId: string | null;
}

/**
 * Everyone who holds a level in this workspace and is not removed, with the
 * manager stored on their row: anchored here, or a membership here
 * (docs-found fixes batch 6). One statement, two indexed halves:
 *
 *   anchored here       "User" by "User_organizationId_idx"
 *   a membership here   "OrganizationMembership" by
 *                       "OrganizationMembership_organizationId_idx", each
 *                       person then by "User_pkey"
 *
 * The second half leaves out the people anchored here, so UNION ALL answers
 * each person once (a membership is unique per person and workspace) with no
 * sort to drop duplicates. `activeOnly` leaves deactivated people out too.
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
      SELECT u."id", u."managerId"
        FROM "OrganizationMembership" m
        JOIN "User" u ON u."id" = m."userId"
       WHERE m."organizationId" = ${organizationId}
         AND u."organizationId" <> ${organizationId}
         AND u."deletedAt" IS NULL
         AND u."status" <> 'INACTIVE'`;
  }
  return db.$queryRaw<WorkspacePersonLine[]>`
    SELECT u."id", u."managerId"
      FROM "User" u
     WHERE u."organizationId" = ${organizationId}
       AND u."deletedAt" IS NULL
    UNION ALL
    SELECT u."id", u."managerId"
      FROM "OrganizationMembership" m
      JOIN "User" u ON u."id" = m."userId"
     WHERE m."organizationId" = ${organizationId}
       AND u."organizationId" <> ${organizationId}
       AND u."deletedAt" IS NULL`;
}

/**
 * Every dotted line from someone who holds a level in this workspace and is
 * not removed (the dotted-lines loop walk). The same two indexed halves as
 * workspacePeopleLines, each joined to "UserDottedLine" by
 * "UserDottedLine_userId_idx".
 */
export async function workspaceDottedLines(organizationId: string, db: Db = prisma): Promise<Array<{ userId: string; managerId: string }>> {
  return db.$queryRaw<Array<{ userId: string; managerId: string }>>`
    SELECT d."userId", d."managerId"
      FROM "User" u
      JOIN "UserDottedLine" d ON d."userId" = u."id"
     WHERE u."organizationId" = ${organizationId}
       AND u."deletedAt" IS NULL
    UNION ALL
    SELECT d."userId", d."managerId"
      FROM "OrganizationMembership" m
      JOIN "User" u ON u."id" = m."userId"
      JOIN "UserDottedLine" d ON d."userId" = u."id"
     WHERE m."organizationId" = ${organizationId}
       AND u."organizationId" <> ${organizationId}
       AND u."deletedAt" IS NULL`;
}

/**
 * levelHeldIn for many people at once, in at most two reads: the level each
 * holds in this one workspace. Absent from the answer: anyone who holds
 * neither a row anchored here nor a membership here (or has no row). The
 * membership read runs only for people anchored somewhere else.
 */
export async function levelsHeldIn(organizationId: string, userIds: readonly string[], db: Db = prisma): Promise<Map<string, AccessLevel>> {
  const ids = [...new Set(userIds)].filter(Boolean);
  if (ids.length === 0) return new Map();
  const rows = await db.user.findMany({ where: { id: { in: ids } }, select: { id: true, organizationId: true, accessLevel: true } });
  return levelsHeldFor(organizationId, rows, db);
}

/**
 * levelsHeldIn for rows the caller already read (each with its anchored
 * workspace and level), in at most one more read: the memberships of the
 * people anchored somewhere else. THE answer to "is this person in this
 * workspace, and at what level" for every read of reporting lines and the
 * people they count (docs-found fixes batch 5): User.organizationId is only
 * the workspace a person last switched to, on any device, so "anchored here"
 * alone drops everyone who works here and was last somewhere else.
 */
export async function levelsHeldFor(
  organizationId: string,
  rows: ReadonlyArray<{ id: string; organizationId: string; accessLevel: AccessLevel }>,
  db: Db = prisma,
): Promise<Map<string, AccessLevel>> {
  const out = new Map<string, AccessLevel>();
  const elsewhere: string[] = [];
  for (const r of rows) {
    if (r.organizationId === organizationId) out.set(r.id, r.accessLevel);
    else elsewhere.push(r.id);
  }
  if (elsewhere.length > 0) {
    const held = await db.organizationMembership.findMany({ where: { organizationId, userId: { in: [...new Set(elsewhere)] } }, select: { userId: true, role: true } });
    for (const h of held) out.set(h.userId, h.role);
  }
  return out;
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
    db.organizationMembership.findMany({ where: { userId: { in: persons }, organizationId: { not: organizationId } }, select: { userId: true, organizationId: true } }),
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
    db.organizationMembership.findMany({ where: { userId: { in: managers }, organizationId: { in: orgs } }, select: { userId: true, organizationId: true, role: true } }),
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
