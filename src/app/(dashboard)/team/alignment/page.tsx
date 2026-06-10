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
  Target, ChartLine, BookOpenCheck, Users as UsersIcon, ChevronRight, ClipboardCheck,
} from "lucide-react";
import { TeamAlignmentBoard } from "./team-alignment-board";

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
    <div className="px-8 py-6 max-w-[1280px]">
      <header className="mb-6 flex items-end justify-between gap-6">
        <div className="min-w-0">
          <div className="flex items-center gap-2 text-sm text-zinc-500 mb-2">
            <UsersIcon className="w-3.5 h-3.5" />
            <span>Team</span>
            <span>/</span>
            <span>Alignment</span>
          </div>
          <h1 className="text-2xl font-semibold">Team alignment</h1>
          <p className="text-sm text-zinc-500 mt-1 max-w-[640px]">
            Your direct and dotted-line reports — what they own, how they're tracking, what they owe.
          </p>
        </div>
        <div className="flex items-center gap-2">
          {/* Director rollup link — director gate enforced server-side
              on /team/rollup; rendered for everyone but redirects
              non-directors back here. */}
          <Link
            href="/team/rollup"
            className="inline-flex items-center gap-1.5 h-8 px-3 rounded-md text-sm border border-zinc-200 hover:bg-zinc-50"
          >
            <UsersIcon className="w-3.5 h-3.5" />
            Director rollup
          </Link>
          <Link
            href="/team/reviews"
            className="inline-flex items-center gap-1.5 h-8 px-3 rounded-md text-sm border border-zinc-200 hover:bg-zinc-50"
          >
            <ClipboardCheck className="w-3.5 h-3.5" />
            Weekly reviews
            <ChevronRight className="w-3 h-3" />
          </Link>
        </div>
      </header>

      {data.members.length === 0 ? (
        <div className="border border-zinc-200 rounded-xl px-8 py-16 text-center">
          <UsersIcon className="w-8 h-8 mx-auto text-zinc-500 mb-3" />
          <div className="text-base font-medium mb-1">No reports yet</div>
          <p className="text-sm text-zinc-500 max-w-[420px] mx-auto">
            You'll see KRAs, KPI compliance, and SOP read-rates here as soon as someone reports to you (solid or dotted).
          </p>
        </div>
      ) : (
        <>
          <section className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
            <StatCard Icon={UsersIcon} label="Reports" value={data.totals.reportCount} />
            <StatCard Icon={Target} label="Active KRAs" value={data.totals.activeKras} />
            <StatCard
              Icon={ChartLine}
              label="Avg KPI compliance"
              value={`${data.totals.avgKpiCompliancePct}%`}
              tone={complianceTone(data.totals.avgKpiCompliancePct)}
            />
            <StatCard
              Icon={BookOpenCheck}
              label="Avg SOP read-rate"
              value={`${data.totals.avgSopReadRatePct}%`}
              tone={complianceTone(data.totals.avgSopReadRatePct)}
            />
          </section>

          <TeamAlignmentBoard members={data.members} />
        </>
      )}
    </div>
  );
}

function StatCard({
  Icon,
  label,
  value,
  tone,
}: {
  Icon: React.ComponentType<{ className?: string }>;
  label: string;
  value: string | number;
  tone?: "good" | "warn" | "bad";
}) {
  const valueColor =
    tone === "bad" ? "text-red-600" :
    tone === "warn" ? "text-amber-600" :
    tone === "good" ? "text-emerald-600" :
    undefined;
  return (
    <div className="rounded-lg border border-zinc-200 bg-white px-4 py-3">
      <div className="flex items-center gap-1.5 text-xs text-zinc-500">
        <Icon className="w-3.5 h-3.5" />
        {label}
      </div>
      <div className={`text-2xl font-semibold mt-1 ${valueColor ?? ""}`}>{value}</div>
    </div>
  );
}

function complianceTone(pct: number): "good" | "warn" | "bad" {
  if (pct >= 80) return "good";
  if (pct >= 50) return "warn";
  return "bad";
}
