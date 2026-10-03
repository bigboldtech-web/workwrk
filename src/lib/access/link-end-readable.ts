// Which SOP, goal, key result, KRA and KPI ends of entity links a person may
// read: one loader for the link list (GET /api/entity-links) and for adding
// or removing a link (POST, DELETE), so the three answer by the same rules
// the task Connection trail already reads (src/lib/task-trail-server.ts).
//
// - A SOP follows the SOP list's and the SOP page's rule (sopVisibilityWhere).
// - A goal follows the Goals list's rule (goalVisibilityOr), which opens at
//   least every goal the goal page does, so no link to a goal a person can
//   open is ever hidden; a key result follows its goal.
// - A KRA or a KPI is readable by every Member of the workspace and by no
//   Guest (the /api/kras library rule).
//
// Each set holds only ids that exist in this workspace, so a guessed id, or
// one from another workspace, is never readable. A set is filled only for
// the end types present; the others come back empty.

import { prisma } from "@/lib/prisma";
import { sopVisibilityWhere } from "@/lib/sop-access";
import { goalVisibilityOr } from "@/lib/goal-audience";
import { orgRoleOf } from "./org-role";

export interface ReadableLinkEnds {
  readableSops: Set<string>;
  readableGoals: Set<string>;
  readableKeyResults: Set<string>;
  /** Keys "KRA:<id>" and "KPI:<id>". */
  readableKras: Set<string>;
}

type LinkSession = { user: { id: string; organizationId: string; accessLevel: string } };

export async function loadReadableLinkEnds(
  session: LinkSession,
  orgId: string,
  ends: ReadonlyArray<{ type: string; id: string }>,
): Promise<ReadableLinkEnds> {
  const idsOf = (type: string) => [...new Set(ends.filter((e) => e.type === type).map((e) => e.id))];
  const sopIds = idsOf("SOP");
  const goalIds = idsOf("OKR");
  const krIds = idsOf("KEY_RESULT");
  const kraIds = idsOf("KRA");
  const kpiIds = idsOf("KPI");
  const member = orgRoleOf({ accessLevel: session.user.accessLevel }) !== "GUEST";
  const goalOr = goalIds.length || krIds.length ? await goalVisibilityOr(session) : null;
  const [sops, goals, krs, kras, kpis] = await Promise.all([
    sopIds.length
      ? sopVisibilityWhere(session).then((vis) => prisma.sOP.findMany({ where: { AND: [{ organizationId: orgId, id: { in: sopIds } }, vis] }, select: { id: true } }))
      : Promise.resolve([] as Array<{ id: string }>),
    goalIds.length
      ? prisma.oKR.findMany({ where: { organizationId: orgId, id: { in: goalIds }, ...(goalOr ? { OR: goalOr } : {}) }, select: { id: true } })
      : Promise.resolve([] as Array<{ id: string }>),
    krIds.length
      ? prisma.keyResult.findMany({ where: { id: { in: krIds }, okr: { organizationId: orgId, ...(goalOr ? { OR: goalOr } : {}) } }, select: { id: true } })
      : Promise.resolve([] as Array<{ id: string }>),
    member && kraIds.length
      ? prisma.kRA.findMany({ where: { organizationId: orgId, id: { in: kraIds } }, select: { id: true } })
      : Promise.resolve([] as Array<{ id: string }>),
    member && kpiIds.length
      ? prisma.kPI.findMany({ where: { organizationId: orgId, id: { in: kpiIds } }, select: { id: true } })
      : Promise.resolve([] as Array<{ id: string }>),
  ]);
  return {
    readableSops: new Set(sops.map((r) => r.id)),
    readableGoals: new Set(goals.map((r) => r.id)),
    readableKeyResults: new Set(krs.map((r) => r.id)),
    readableKras: new Set([...kras.map((r) => `KRA:${r.id}`), ...kpis.map((r) => `KPI:${r.id}`)]),
  };
}
