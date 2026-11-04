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
import { membershipHereWhere } from "./seated-here";

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
 * nothing anywhere). Step 8's helper (E15) reads both halves for the
 * audiences and the listed counts.
 */
export async function membershipsPlacedHere(
  organizationId: string,
  placement: { departmentId: string } | { roleId: string } | { officeId: string },
  db: Db = prisma,
): Promise<number> {
  return db.organizationMembership.count({ where: { ...membershipHereWhere(organizationId, "kept"), ...placement } });
}
