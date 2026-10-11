// "An Agent is never anyone's manager" (access 2.4, AGENT_TIER_BLURB), for
// the server paths outside a request's people context: an invitation's
// Reports to (sendInvitation, and managerOnAccept when it is accepted) and
// the handover's report plan. The same rule as person-access.server.ts
// checkManagerCandidate and agentIdsAmong (same workspace, not removed,
// never the Agent tier), kept here because the tier is the engine's to read
// (the G7 lint rule) and these modules must stay importable outside a
// request.
//
// Server-only (prisma), with no request imports.

import { prisma } from "@/lib/prisma";
import { isAgentOf } from "./org-role";

export type ManagerCandidate = "ok" | "not_found" | "agent_cannot_manage";

/** May `managerId` manage someone in this workspace? */
export async function managerCandidateIn(organizationId: string, managerId: string): Promise<ManagerCandidate> {
  const m = await prisma.user.findFirst({ where: { id: managerId, organizationId, deletedAt: null }, select: { accessLevel: true } });
  if (!m) return "not_found";
  return isAgentOf(m.accessLevel) ? "agent_cannot_manage" : "ok";
}

/** The people among `ids` in this workspace who hold the Agent tier. */
export async function agentIdsIn(organizationId: string, ids: readonly string[]): Promise<Set<string>> {
  if (ids.length === 0) return new Set();
  const rows = await prisma.user.findMany({ where: { id: { in: [...ids] }, organizationId }, select: { id: true, accessLevel: true } });
  return new Set(rows.filter((r) => isAgentOf(r.accessLevel)).map((r) => r.id));
}
