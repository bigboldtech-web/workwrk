// /team/alignment: Alignment, the "My reports" view (spec-goals section 2).
// One line per person the viewer manages (the recursive chain, solid and
// dotted; the organization for the People team and Admin): their KRAs, KPI
// compliance, SOP read-rate and this week's review with Approve and Request
// changes right there. /team/rollup is the Sub-teams view of the same page.
//
// Gate: the `alignment` APP_RULES row (anyone with reports over their
// chain, the People team and Admin over the org); anyone else gets the
// in-shell 404. ?manager={id} drills into one manager's team (from the
// Sub-teams rows) and 404s unless the viewer holds that manager in their
// chain (or is the People team or Admin).
//
// Moved, not dropped: the four stat tiles are the table's footer and
// sortable columns (the org averages sit on the Sub-teams summary line);
// the "Reviews" header button is the Weekly reviews sidebar row; the
// "Rollup" button is the Sub-teams pill, rendered only when it applies.

import { notFound, redirect } from "next/navigation";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { gatePage } from "@/lib/access/gate";
import { getTeamAlignment } from "@/lib/team-alignment";
import { kpiActorCtx, mayActOnKpisOf } from "@/lib/kpi-review.server";
import { reportsHereOf, workspacePeopleLines } from "@/lib/access/acting-workspace";
import { personHere } from "@/lib/access/seated-here";
import { AlignmentView } from "@/components/team/alignment-view";

export const dynamic = "force-dynamic";

export default async function TeamAlignmentPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const session = await getServerSession(authOptions);
  if (!session?.user) redirect("/login");
  const u = session.user as { id?: string; organizationId?: string };
  if (!u.id || !u.organizationId) redirect("/login");
  await gatePage("view", { type: "app", key: "alignment" }, { callbackUrl: "/team/alignment" });

  const sp = await searchParams;
  const managerParam = typeof sp.manager === "string" ? sp.manager : null;
  const ctx = await kpiActorCtx();
  if (!ctx) redirect("/login");

  let drill: { name: string } | null = null;
  let managerId = u.id;
  if (managerParam && managerParam !== u.id) {
    // A manager outside the viewer's chain is not discoverable.
    if (!mayActOnKpisOf(ctx, managerParam)) notFound();
    // A manager here through a membership leads a team here too (E1): read at the seat here, not removed.
    const m = await personHere(u.organizationId, managerParam, "kept");
    if (!m) notFound();
    drill = { name: `${m.firstName ?? ""} ${m.lastName ?? ""}`.trim() || m.email };
    managerId = managerParam;
  }

  // The People team and Admin see the organization; everyone else (and any
  // drill-down) sees a manager's chain.
  const orgWide = !drill && (ctx.isAdmin || ctx.peopleTeam);
  const data = await getTeamAlignment({ managerId, organizationId: u.organizationId, orgWide });
  // The Sub-teams pill renders only when it applies: one of the viewer's
  // direct reports has reports of their own.
  // For the People team and Admin, Sub-teams reads the top of the org, so
  // the pill applies when someone with no manager manages people.
  // Both read THIS workspace's lines (docs/plans/workspace-status-2.md E1,
  // step 2): the account's line of people anchored here, the membership's
  // of people here through one. Before, the people anchored here alone, by
  // their account's line and the cross-workspace directReports relation.
  const hasSubTeams = !drill && (await hasSubTeamsHere(u.organizationId, u.id, orgWide));

  return (
    <div className="flex h-full flex-col overflow-y-auto bg-raised">
      <AlignmentView people={data.members} hasSubTeams={hasSubTeams} drill={drill} />
    </div>
  );
}

/**
 * Does Sub-teams apply? Org-wide: someone here with no manager here manages
 * someone here. Otherwise: one of the viewer's reports here has reports here.
 * Removed people are never counted, a deactivated one is (as before).
 */
async function hasSubTeamsHere(organizationId: string, viewerId: string, orgWide: boolean): Promise<boolean> {
  if (orgWide) {
    const lines = new Map((await workspacePeopleLines(organizationId)).map((p) => [p.id, p.managerId]));
    for (const managerId of lines.values()) if (managerId && lines.get(managerId) === null) return true;
    return false;
  }
  const directs = (await reportsHereOf(organizationId, [viewerId])).map((r) => r.id).filter((id) => id !== viewerId);
  return directs.length > 0 && (await reportsHereOf(organizationId, directs)).some((r) => r.id !== r.managerId);
}
