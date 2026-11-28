// The company wall: no one reads, writes or is shown anything in a workspace
// they hold no seat in.
//
// The node gates (boardRoleOf, spaceRoleOf, folderReadable,
// folderAccessForSpace) decided a role from the row's OWN workspace and the
// level the caller passed, and left the workspace check to each caller. Two
// routes forgot it: any person read another company's Lists by id, and any
// company admin, a stranger who signed up for a free workspace included, read
// every List of every company, Private ones too (pen test 2026-11-28, V-01).
// The check now lives in the gates, so a caller can no longer forget it.
//
// "Holds a seat" is the rule every read of a person here follows
// (acting-workspace.ts levelHeldIn): anchored in this workspace, or a live
// membership in it. A person in two workspaces keeps their Lists in both, on
// every device. The gates then decide with the level the person holds IN THE
// ROW'S WORKSPACE, never the level the caller passed: that one may be another
// workspace's (an admin there, an employee here) or a stale token's.

import type { AccessLevel } from "@/generated/prisma";
import { prisma } from "@/lib/prisma";
import { levelHeldIn } from "@/lib/access/acting-workspace";
import { seatedHereAmong } from "@/lib/access/seated-here";

/** The level this person holds in this workspace, or null: no seat, no access. */
export async function levelInCompany(userId: string, organizationId: string): Promise<AccessLevel | null> {
  if (!userId || !organizationId) return null;
  return levelHeldIn(userId, organizationId);
}

export type WalledModel =
  | "kra" | "role" | "scope" | "kraCategory" | "idea"
  | "planScenario" | "glAccount" | "costCenter" | "accountingPeriod" | "planDriver";

async function idsIn(model: WalledModel, where: { id: { in: string[] }; organizationId: string }): Promise<{ id: string }[]> {
  const select = { id: true } as const;
  switch (model) {
    case "kra": return prisma.kRA.findMany({ where, select });
    case "role": return prisma.role.findMany({ where, select });
    case "scope": return prisma.scope.findMany({ where, select });
    case "kraCategory": return prisma.kraCategory.findMany({ where, select });
    case "idea": return prisma.idea.findMany({ where, select });
    case "planScenario": return prisma.planScenario.findMany({ where, select });
    case "glAccount": return prisma.glAccount.findMany({ where, select });
    case "costCenter": return prisma.costCenter.findMany({ where, select });
    case "accountingPeriod": return prisma.accountingPeriod.findMany({ where, select });
    case "planDriver": return prisma.planDriver.findMany({ where, select });
  }
}

const given = (ids: ReadonlyArray<unknown>): string[] =>
  [...new Set(ids.filter((x): x is string => typeof x === "string" && x.length > 0))];

/**
 * Every given id (empty ones ignored) is a row of this workspace. For a write
 * that stores another row's id (a KRA on a KPI, a period on a plan line): an
 * id from another workspace must never be written, shown back, or left to
 * block that workspace's own deletes (pen test 2026-11-28, V-03 to V-07).
 */
export async function allOwned(model: WalledModel, ids: ReadonlyArray<unknown>, organizationId: string): Promise<boolean> {
  const want = given(ids);
  if (want.length === 0) return true;
  if (!organizationId) return false;
  const rows = await idsIn(model, { id: { in: want }, organizationId });
  return rows.length === want.length;
}

/**
 * Every given person id (empty ones ignored) holds a seat in this workspace
 * (anchored here or a membership here; a deactivated one counts, a removed one
 * does not). Before a write stores a person: a role instance for someone in
 * another company handed back their name and email (V-02).
 */
export async function allPeopleHere(ids: ReadonlyArray<unknown>, organizationId: string): Promise<boolean> {
  const want = given(ids);
  if (want.length === 0) return true;
  if (!organizationId) return false;
  const here = await seatedHereAmong(organizationId, want, "kept");
  return want.every((id) => here.has(id));
}

/** A value that may be stored as an id: a non-empty string, or null to clear. Anything else is refused. */
export function idOrNull(v: unknown): string | null | "invalid" {
  if (v === null) return null;
  if (typeof v === "string") return v.length > 0 ? v : null;
  return "invalid";
}
