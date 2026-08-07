// /team/workload — manager-scoped workspace Workload. The same
// WorkloadGrid the board-level WORKLOAD view renders, fed by every
// readable Item across the org (listEverythingItems, newest-500 cap)
// filtered to the caller's recursive report tree + unassigned rows.
//
// Gate mirrors the manager-only stance of /api/tasks/workload: a caller
// whose team set is just themselves has no reports to balance, so they
// bounce to /team. Settings persist client-side in localStorage (no
// View row exists at workspace scope) — see team-workload-view.tsx.

import { redirect } from "next/navigation";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { GaugeCircle } from "lucide-react";
import { prisma } from "@/lib/prisma";
import { getTeamUserIds } from "@/lib/team";
import { listEverythingItems } from "@/lib/everything";
import { TeamWorkloadView } from "./team-workload-view";

export const dynamic = "force-dynamic";

export default async function TeamWorkloadPage() {
  const session = await getServerSession(authOptions);
  if (!session?.user) redirect("/login");
  const u = session.user as { id?: string; organizationId?: string; accessLevel?: string };
  if (!u.id || !u.organizationId) redirect("/login");

  const teamIds = await getTeamUserIds(u.organizationId, u.id);
  if (teamIds.length <= 1) redirect("/team");
  const teamSet = new Set(teamIds);

  const [all, people] = await Promise.all([
    listEverythingItems(u.organizationId, u.id, u.accessLevel ?? "EMPLOYEE"),
    prisma.user.findMany({
      where: { id: { in: teamIds } },
      select: { id: true, firstName: true, lastName: true, avatar: true },
    }),
  ]);
  // Team-owned rows + unassigned rows (the grid's Unassigned bucket).
  const items = all.filter((it) => (it.ownerId ? teamSet.has(it.ownerId) : true));

  return (
    <div className="flex flex-col h-full bg-white">
      {/* Header — board-page style: title + people count */}
      <div className="px-4 pt-1.5 pb-1 flex items-center gap-2">
        <h1 className="inline-flex items-center gap-1.5 text-[14px] font-semibold text-zinc-900">
          <GaugeCircle className="w-4 h-4 text-zinc-500" />
          <span>Workload</span>
        </h1>
        <span className="text-[12px] text-zinc-500 tabular-nums">
          {people.length} people
        </span>
      </div>

      <div className="flex-1 overflow-y-auto px-4 pt-2 pb-4">
        <TeamWorkloadView items={items} people={people} />
      </div>
    </div>
  );
}
