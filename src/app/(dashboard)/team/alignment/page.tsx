// /team/alignment — manager rollup of the people who report to you
// (solid + dotted). Phase 4c of the ClickUp overhaul.
//
// Sections:
//   1. Hero stats — # reports, total active KRAs, avg KPI compliance,
//      avg SOP read-rate.
//   2. Per-report grid — one card per direct + dotted report with
//      their KRAs, KPI compliance %, SOP read-rate, mandatory-pending
//      SOP count.
//
// Gate: central access resolver (Phase 6) — module "team/alignment"
// requires manager+. Employees / agents redirect home.

import { redirect } from "next/navigation";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { resolveAccess, meets } from "@/lib/access";
import { getTeamAlignment } from "@/lib/team-alignment";
import Link from "next/link";
import {
  Target, ChartLine, BookOpenCheck, Users as UsersIcon, ClipboardCheck, BarChart3,
} from "lucide-react";
import { TeamAlignmentBoard } from "./team-alignment-board";
import { TeamStatTile } from "@/components/team/ui";

export const dynamic = "force-dynamic";

export default async function TeamAlignmentPage() {
  const session = await getServerSession(authOptions);
  if (!session?.user) redirect("/login");
  const u = session.user as { id?: string; organizationId?: string; accessLevel?: string };
  if (!u.id || !u.organizationId) redirect("/login");

  // Phase 6 — central access resolver gate.
  const decision = await resolveAccess(
    { userId: u.id, organizationId: u.organizationId, accessLevel: u.accessLevel ?? "EMPLOYEE" },
    { type: "module", name: "team/alignment" },
  );
  if (!meets(decision, "read")) redirect("/today");

  const data = await getTeamAlignment({ managerId: u.id, organizationId: u.organizationId });

  return (
    <div className="flex flex-col h-full bg-white">
      {/* Chrome */}
      <div className="px-6 pt-4 pb-3">
        <div className="flex items-center gap-1.5 text-xs text-zinc-500 mb-2">
          <Link href="/team" className="hover:text-zinc-900">Teams</Link>
          <span className="text-zinc-300">/</span>
          <span>Alignment board</span>
        </div>
        <div className="flex items-center gap-3">
          <span className="inline-flex h-9 w-9 items-center justify-center rounded-lg bg-[#0073EA]/10 shrink-0">
            <Target className="h-5 w-5 text-[#0073EA]" />
          </span>
          <h1 className="text-base font-semibold text-zinc-900">Alignment board</h1>
          <span className="text-xs text-zinc-400 hidden sm:inline">your reports — what they own, how they&rsquo;re tracking</span>
          <div className="flex-1" />
          <Link href="/team/rollup" className="inline-flex items-center gap-1.5 h-8 px-3 rounded-md text-[13px] text-zinc-700 border border-zinc-200 hover:bg-zinc-50">
            <BarChart3 className="w-3.5 h-3.5 text-zinc-400" /> Rollup
          </Link>
          <Link href="/team/reviews" className="inline-flex items-center gap-1.5 h-8 px-3 rounded-md text-[13px] text-zinc-700 border border-zinc-200 hover:bg-zinc-50">
            <ClipboardCheck className="w-3.5 h-3.5 text-zinc-400" /> Reviews
          </Link>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto px-6 py-4 space-y-6 max-w-[1280px]">
        {data.members.length === 0 ? (
          <div className="border border-zinc-200 rounded-xl px-8 py-16 text-center">
            <UsersIcon className="w-8 h-8 mx-auto text-zinc-400 mb-3" />
            <div className="text-base font-medium mb-1 text-zinc-900">No reports yet</div>
            <p className="text-sm text-zinc-500 max-w-[420px] mx-auto">
              You&rsquo;ll see KRAs, KPI compliance, and SOP read-rates here as soon as someone reports to you (solid or dotted).
            </p>
          </div>
        ) : (
          <>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              <TeamStatTile icon={UsersIcon} label="Reports" value={data.totals.reportCount} accent="#0073EA" sub="direct + dotted" />
              <TeamStatTile icon={Target} label="Active KRAs" value={data.totals.activeKras} accent="#6366F1" sub="across your team" />
              <TeamStatTile icon={ChartLine} label="Avg KPI compliance" value={`${data.totals.avgKpiCompliancePct}%`} accent={complianceAccent(data.totals.avgKpiCompliancePct)} />
              <TeamStatTile icon={BookOpenCheck} label="Avg SOP read-rate" value={`${data.totals.avgSopReadRatePct}%`} accent={complianceAccent(data.totals.avgSopReadRatePct)} />
            </div>

            <TeamAlignmentBoard members={data.members} />
          </>
        )}
      </div>
    </div>
  );
}

function complianceAccent(pct: number): string {
  if (pct >= 80) return "#16a34a";
  if (pct >= 50) return "#f59e0b";
  return "#dc2626";
}
