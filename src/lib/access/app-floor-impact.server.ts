// The people half of the Apps page's "N people lose access" preview: every
// live person of the workspace with the facts keepsApp reads. Server-only.

import { prisma } from "@/lib/prisma";
import { loadOrgFacts } from "./facts";
import { orgRoleOf, isSeededPeopleTeam } from "./org-role";
import { accessV2Tables } from "./flags";
import { tiersOfLevel } from "./viewer-tiers";
import type { ImpactPerson } from "./app-floor-impact";

/**
 * The Guests of the org who hold something of this app's kind, for the app
 * keys the engine can answer that for (facts.ts guestHoldsSomethingFor:
 * Talk channels, SOP folders and SOP assignments). undefined for the rest,
 * which keepsApp reads as shared, the engine's own permissive answer.
 */
async function guestsHolding(organizationId: string, guestIds: string[], appKey: string | null | undefined): Promise<Set<string> | undefined> {
  if (guestIds.length === 0) return new Set();
  if (appKey === "chat") {
    const rows = await prisma.conversationMember.findMany({
      where: { userId: { in: guestIds }, conversation: { organizationId } },
      select: { userId: true },
      distinct: ["userId"],
    });
    return new Set(rows.map((r) => r.userId));
  }
  if (appKey === "sops") {
    const [folders, assigned] = await Promise.all([
      prisma.sOPFolderAccess.findMany({ where: { userId: { in: guestIds }, folder: { organizationId } }, select: { userId: true }, distinct: ["userId"] }),
      prisma.sOPAssignment.findMany({ where: { userId: { in: guestIds }, sop: { organizationId } }, select: { userId: true }, distinct: ["userId"] }),
    ]);
    return new Set([...folders, ...assigned].map((r) => r.userId));
  }
  return undefined;
}

export async function loadImpactPeople(organizationId: string, appKey?: string | null): Promise<ImpactPerson[]> {
  const [users, org, dotted] = await Promise.all([
    prisma.user.findMany({
      where: { organizationId, deletedAt: null, status: "ACTIVE" },
      select: { id: true, firstName: true, lastName: true, email: true, accessLevel: true, managerId: true },
      take: 20000,
    }),
    loadOrgFacts(organizationId),
    prisma.userDottedLine.findMany({ where: { user: { organizationId, deletedAt: null } }, select: { managerId: true } }),
  ]);
  const managers = new Set<string>();
  for (const u of users) if (u.managerId) managers.add(u.managerId);
  for (const d of dotted) managers.add(d.managerId);
  // The People team the engine reads (resolve.ts isPeopleTeam, the same
  // union boot ships as viewer.peopleTeam): the configured list, plus an
  // HR-level user while ACCESS_V2_TABLES is off (org-role.ts peopleTeamOf).
  const peopleTeam = new Set(org.peopleTeamIds);
  const tablesOn = accessV2Tables();
  const roles = new Map(users.map((u) => [u.id, orgRoleOf({ accessLevel: u.accessLevel })]));
  const guestIds = users.filter((u) => roles.get(u.id) === "GUEST").map((u) => u.id);
  const holding = await guestsHolding(organizationId, guestIds, appKey);
  return users.map((u) => {
    const orgRole = roles.get(u.id) ?? "GUEST";
    return {
      id: u.id,
      name: [u.firstName, u.lastName].filter(Boolean).join(" ").trim() || u.email || "Someone",
      orgRole,
      peopleTeam: peopleTeam.has(u.id) || (!tablesOn && isSeededPeopleTeam(u.accessLevel)),
      hasReports: managers.has(u.id),
      tiers: tiersOfLevel(u.accessLevel),
      ...(orgRole === "GUEST" && holding ? { shared: holding.has(u.id) } : {}),
    };
  });
}
