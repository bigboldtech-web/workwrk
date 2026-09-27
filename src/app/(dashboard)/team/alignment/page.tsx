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
import { prisma } from "@/lib/prisma";
import { kpiActorCtx, mayActOnKpisOf } from "@/lib/kpi-review.server";
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
    const m = await prisma.user.findFirst({ where: { id: managerParam, organizationId: u.organizationId, deletedAt: null }, select: { firstName: true, lastName: true, email: true } });
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
  const hasSubTeams = !drill && (await prisma.user.count({
    where: orgWide
      ? { organizationId: u.organizationId, deletedAt: null, managerId: null, directReports: { some: { deletedAt: null } } }
      : { organizationId: u.organizationId, deletedAt: null, manager: { managerId: u.id, deletedAt: null } },
  })) > 0;

  return (
    <div className="flex h-full flex-col overflow-y-auto bg-surface">
      <AlignmentView people={data.members} hasSubTeams={hasSubTeams} drill={drill} />
    </div>
  );
}
