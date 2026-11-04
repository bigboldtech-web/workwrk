// /team/rollup: Sub-teams, the second view of Alignment (spec-goals section
// 2). For a manager of managers: one line per manager under the viewer and
// a way into that manager's team; then the direct reports who manage nobody,
// in the Alignment row shape with the same Approve and Request changes.
//
// Gate: the `rollup` APP_RULES row as printed (anyone with reports over
// their chain, the People team and Admin over the org), which replaced the
// Director-only set. The People team and Admin read the top of the
// organization (everyone with no manager); a viewer who passes but whose
// reports manage nobody gets the direct-reports group and one note line.
//
// Moved, not dropped: the six stat tiles are the one summary line above the
// card; the "Alignment" header button is the views row; a row's chevron to
// the profile is the row "..." > Open profile, and the row itself now
// drills into the manager's team.

import { redirect } from "next/navigation";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { gatePage } from "@/lib/access/gate";
import { prisma } from "@/lib/prisma";
import { getDirectorRollup } from "@/lib/team-rollup";
import { getTeamAlignment } from "@/lib/team-alignment";
import { kpiActorCtx } from "@/lib/kpi-review.server";
import { SubTeamsView, type SubTeamRow } from "@/components/team/sub-teams-view";
import { ownHere } from "@/lib/access/profile-here";
import { workspacePeopleLines } from "@/lib/access/acting-workspace";

export const dynamic = "force-dynamic";

export default async function TeamRollupPage() {
  const session = await getServerSession(authOptions);
  if (!session?.user) redirect("/login");
  const u = session.user as { id?: string; organizationId?: string };
  if (!u.id || !u.organizationId) redirect("/login");
  await gatePage("view", { type: "app", key: "rollup" }, { callbackUrl: "/team/rollup" });

  const ctx = await kpiActorCtx();
  if (!ctx) redirect("/login");
  const orgWide = ctx.isAdmin || ctx.peopleTeam;
  // Org-wide viewers see every top of the company AND their own direct
  // reports (who sit under them, so they are not roots): without the second
  // half an admin's own team fell out of the page.
  // Each read at THIS workspace's line (docs/plans/workspace-status-2.md
  // E1, step 2): the account's for people anchored here, the membership's
  // for people here through one, live seats (workspacePeopleLines). Before,
  // the people anchored here alone, by their account's line.
  const rootIds = orgWide
    ? (await workspacePeopleLines(u.organizationId, { activeOnly: true }))
        .filter((r) => r.id !== u.id && (r.managerId === null || r.managerId === u.id))
        .map((r) => r.id)
    : undefined;
  const data = await getDirectorRollup({ directorId: u.id, organizationId: u.organizationId, rootIds });

  const managerIds = data.subTeams.map((t) => t.manager.id);
  // A job title only when it is this workspace's own (docs/plans/workspace-status.md D18).
  const titles = managerIds.length
    ? await prisma.user.findMany({ where: { id: { in: managerIds } }, select: { id: true, role: { select: { title: true, organizationId: true } } } })
    : [];
  const titleOf = new Map(titles.map((t) => [t.id, ownHere(t.role, u.organizationId as string)?.title ?? null]));
  const subTeams: SubTeamRow[] = data.subTeams.map((t) => ({ ...t.manager, jobTitle: titleOf.get(t.manager.id) ?? null, metrics: t.metrics }));

  // The direct ICs in the Alignment row shape (weekly review id included, so
  // Approve and Request changes work here exactly as on My reports).
  const icIds = new Set(data.directIcs.map((d) => d.id));
  const alignment = icIds.size ? await getTeamAlignment({ managerId: u.id, organizationId: u.organizationId, orgWide }) : null;
  const directIcs = (alignment?.members ?? []).filter((m) => icIds.has(m.id));

  return (
    <div className="flex h-full flex-col overflow-y-auto bg-raised">
      <SubTeamsView subTeams={subTeams} directIcs={directIcs} totals={data.totals} orgWide={orgWide} />
    </div>
  );
}
