// /team/rollup — director rollup of the reporting tree, one level
// deeper than /team/alignment. Director-gated (DIRECTOR+).
//
// Layout:
//   - Hero strip — sub-teams, direct ICs, agg report count, four
//     team-wide health metrics (KPI %, SOP %, review submitted %,
//     review approved %).
//   - Sub-teams section — one card per sub-manager with their team's
//     rollup metrics + their own weekly-review badge.
//   - Direct ICs section — reports who don't have reports of their
//     own, in a compact list with the three personal metrics.

import { redirect } from "next/navigation";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { getDirectorRollup, type SubTeam, type DirectIcSummary } from "@/lib/team-rollup";
import { resolveAccess, meets } from "@/lib/access";
import Link from "next/link";
import {
  ChartLine, BookOpenCheck, Users as UsersIcon, ChevronRight,
  GitBranchPlus, ClipboardCheck, Target, CheckCircle2, Clock, AlertCircle, BarChart3,
} from "lucide-react";
import { TeamStatTile, pctColor } from "@/components/team/ui";

export const dynamic = "force-dynamic";

export default async function TeamRollupPage() {
  const session = await getServerSession(authOptions);
  if (!session?.user) redirect("/login");
  const u = session.user as { id?: string; accessLevel?: string; organizationId?: string };
  if (!u.id || !u.organizationId) redirect("/login");

  // Phase 6 — central access resolver. Non-directors who land here
  // bounce to /team/alignment so they still get the manager-level
  // view they're entitled to.
  const decision = await resolveAccess(
    { userId: u.id, organizationId: u.organizationId, accessLevel: u.accessLevel ?? "EMPLOYEE" },
    { type: "module", name: "team/rollup" },
  );
  if (!meets(decision, "read")) redirect("/team/alignment");

  const data = await getDirectorRollup({
    directorId: u.id,
    organizationId: u.organizationId,
  });

  return (
    <div className="flex flex-col h-full bg-white">
      <div className="px-6 pt-4 pb-3">
        <div className="flex items-center gap-1.5 text-xs text-zinc-500 mb-2">
          <Link href="/team" className="hover:text-zinc-900">Teams</Link>
          <span className="text-zinc-300">/</span>
          <span>Rollup</span>
        </div>
        <div className="flex items-center gap-3">
          <span className="inline-flex h-9 w-9 items-center justify-center rounded-lg bg-[#0073EA]/10 shrink-0">
            <BarChart3 className="h-5 w-5 text-[#0073EA]" />
          </span>
          <h1 className="text-base font-semibold text-zinc-900">Rollup</h1>
          <span className="text-xs text-zinc-400 hidden sm:inline">two levels below you — every sub-team&rsquo;s health</span>
          <div className="flex-1" />
          <Link href="/team/alignment" className="inline-flex items-center gap-1.5 h-8 px-3 rounded-md text-[13px] text-zinc-700 border border-zinc-200 hover:bg-zinc-50">
            <Target className="w-3.5 h-3.5 text-zinc-400" /> Alignment
          </Link>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto px-6 py-4 max-w-[1280px] space-y-6">
        {data.totals.aggregateReportCount === 0 ? (
          <div className="border border-zinc-200 rounded-xl px-8 py-16 text-center">
            <UsersIcon className="w-8 h-8 mx-auto text-zinc-400 mb-3" />
            <div className="text-base font-medium mb-1 text-zinc-900">No reports yet</div>
            <p className="text-sm text-zinc-500 max-w-[420px] mx-auto">
              The director rollup wakes up as soon as you have direct reports — managers or ICs.
            </p>
          </div>
        ) : (
          <>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              <TeamStatTile icon={GitBranchPlus} label="Sub-teams" value={data.totals.subTeamCount} accent="#6366F1" />
              <TeamStatTile icon={UsersIcon} label="People in tree" value={data.totals.aggregateReportCount} accent="#0073EA"
                sub={`${data.totals.directIcCount} direct · ${data.totals.aggregateReportCount - data.totals.directIcCount} via sub-teams`} />
              <TeamStatTile icon={ChartLine} label="Avg KPI compliance" value={`${data.totals.avgKpiCompliancePct}%`} accent={pctColor(data.totals.avgKpiCompliancePct)} />
              <TeamStatTile icon={BookOpenCheck} label="Avg SOP read-rate" value={`${data.totals.avgSopReadRatePct}%`} accent={pctColor(data.totals.avgSopReadRatePct)} />
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <TeamStatTile icon={ClipboardCheck} label="Weekly review submitted" value={`${data.totals.weeklyReviewSubmittedPct}%`} accent={pctColor(data.totals.weeklyReviewSubmittedPct)}
                sub={`${Math.round((data.totals.weeklyReviewSubmittedPct / 100) * data.totals.aggregateReportCount)} of ${data.totals.aggregateReportCount} ICs`} />
              <TeamStatTile icon={CheckCircle2} label="Weekly review approved" value={`${data.totals.weeklyReviewApprovedPct}%`} accent={pctColor(data.totals.weeklyReviewApprovedPct)}
                sub={`${Math.round((data.totals.weeklyReviewApprovedPct / 100) * data.totals.aggregateReportCount)} of ${data.totals.aggregateReportCount} ICs`} />
            </div>

            {data.subTeams.length > 0 ? (
              <section>
                <h2 className="text-xs uppercase tracking-wide text-zinc-500 mb-2">Sub-teams</h2>
                <ul className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  {data.subTeams.map((t) => (
                    <li key={t.manager.id}><SubTeamCard t={t} /></li>
                  ))}
                </ul>
              </section>
            ) : null}

            {data.directIcs.length > 0 ? (
              <section>
                <h2 className="text-xs uppercase tracking-wide text-zinc-500 mb-2">Direct ICs</h2>
                <ul className="space-y-1.5">
                  {data.directIcs.map((ic) => (
                    <li key={ic.id}><DirectIcRow ic={ic} /></li>
                  ))}
                </ul>
              </section>
            ) : null}
          </>
        )}
      </div>
    </div>
  );
}

function SubTeamCard({ t }: { t: SubTeam }) {
  const initials = `${t.manager.firstName?.[0] ?? ""}${t.manager.lastName?.[0] ?? ""}`.toUpperCase() || "?";
  return (
    <article className="rounded-lg border border-zinc-200 bg-white">
      <header className="flex items-center gap-3 px-4 py-3 border-b border-zinc-200">
        <span className="inline-flex items-center justify-center w-9 h-9 rounded-full bg-zinc-100 text-sm font-medium">
          {initials}
        </span>
        <div className="flex-1 min-w-0">
          <div className="text-sm font-medium truncate">{t.manager.firstName} {t.manager.lastName}</div>
          <div className="text-xs text-zinc-500 truncate">{t.metrics.reportCount} report{t.metrics.reportCount === 1 ? "" : "s"}</div>
        </div>
        <OwnReviewBadge own={t.manager.ownReview} />
        {t.manager.via === "dotted" ? (
          <span className="inline-flex items-center gap-1 text-[10px] uppercase tracking-wide px-1.5 py-0.5 rounded bg-zinc-50 text-zinc-500">
            <GitBranchPlus className="w-3 h-3" /> Dotted
          </span>
        ) : null}
        <Link href={`/people/${t.manager.id}`} className="text-zinc-500 hover:text-zinc-900">
          <ChevronRight className="w-4 h-4" />
        </Link>
      </header>
      <div className="px-4 py-3 grid grid-cols-2 gap-3">
        <SubMetric Icon={Target} label="KRAs" value={t.metrics.activeKras} />
        <SubMetric Icon={ChartLine} label="KPI compliance" value={`${t.metrics.avgKpiCompliancePct}%`} tone={tone(t.metrics.avgKpiCompliancePct)} />
        <SubMetric Icon={BookOpenCheck} label="SOP read-rate" value={`${t.metrics.avgSopReadRatePct}%`} tone={tone(t.metrics.avgSopReadRatePct)} />
        <SubMetric Icon={ClipboardCheck} label="Reviews submitted" value={`${t.metrics.weeklyReviewSubmittedPct}%`} tone={tone(t.metrics.weeklyReviewSubmittedPct)} />
      </div>
    </article>
  );
}

function SubMetric({
  Icon, label, value, tone,
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
    <div>
      <div className="flex items-center gap-1.5 text-[11px] text-zinc-500">
        <Icon className="w-3 h-3" />
        {label}
      </div>
      <div className={`text-base font-semibold ${valueColor ?? ""}`}>{value}</div>
    </div>
  );
}

function OwnReviewBadge({ own }: { own: SubTeam["manager"]["ownReview"] }) {
  if (!own.status) return null;
  if (own.status === "DRAFT") {
    return <span className="text-[10px] uppercase tracking-wide px-1.5 py-0.5 rounded bg-zinc-50 text-zinc-500">Own: Draft</span>;
  }
  if (own.status === "SUBMITTED") {
    return <span className="text-[10px] uppercase tracking-wide px-1.5 py-0.5 rounded bg-amber-500/15 text-amber-700">Own: Submitted</span>;
  }
  const approved = own.managerStatus === "APPROVED";
  return (
    <span className={`text-[10px] uppercase tracking-wide px-1.5 py-0.5 rounded ${
      approved ? "bg-emerald-500/15 text-emerald-700" : "bg-red-500/15 text-red-700"
    }`}>
      {approved ? "Own: Approved" : "Own: Changes"}
    </span>
  );
}

function DirectIcRow({ ic }: { ic: DirectIcSummary }) {
  const initials = `${ic.firstName?.[0] ?? ""}${ic.lastName?.[0] ?? ""}`.toUpperCase() || "?";
  return (
    <div className="flex items-center gap-3 rounded-md border border-zinc-200 bg-white px-3 py-2">
      <span className="inline-flex items-center justify-center w-7 h-7 rounded-full bg-zinc-100 text-xs font-medium">
        {initials}
      </span>
      <div className="flex-1 min-w-0">
        <div className="text-sm truncate">{ic.firstName} {ic.lastName}</div>
        <div className="text-[11px] text-zinc-500 truncate">{ic.email}</div>
      </div>
      {ic.via === "dotted" ? (
        <span className="text-[10px] uppercase tracking-wide px-1.5 py-0.5 rounded bg-zinc-50 text-zinc-500">Dotted</span>
      ) : null}
      <ReviewChip review={ic.weeklyReview} />
      <span className={`text-xs ${toneClass(tone(ic.kpiCompliancePct))}`}>KPI {ic.kpiCompliancePct}%</span>
      <span className={`text-xs ${toneClass(tone(ic.sopReadRatePct))}`}>SOP {ic.sopReadRatePct}%</span>
      <Link href={`/people/${ic.id}`} className="text-zinc-500 hover:text-zinc-900">
        <ChevronRight className="w-4 h-4" />
      </Link>
    </div>
  );
}

function ReviewChip({ review }: { review: DirectIcSummary["weeklyReview"] }) {
  if (!review.status) {
    return <span className="inline-flex items-center gap-1 text-[10px] uppercase tracking-wide px-1.5 py-0.5 rounded bg-red-500/15 text-red-700"><AlertCircle className="w-3 h-3" />No review</span>;
  }
  if (review.status === "DRAFT") {
    return <span className="inline-flex items-center gap-1 text-[10px] uppercase tracking-wide px-1.5 py-0.5 rounded bg-zinc-50 text-zinc-500">Draft</span>;
  }
  if (review.status === "SUBMITTED") {
    return <span className="inline-flex items-center gap-1 text-[10px] uppercase tracking-wide px-1.5 py-0.5 rounded bg-amber-500/15 text-amber-700"><Clock className="w-3 h-3" />Submitted</span>;
  }
  const approved = review.managerStatus === "APPROVED";
  return <span className={`inline-flex items-center gap-1 text-[10px] uppercase tracking-wide px-1.5 py-0.5 rounded ${
    approved ? "bg-emerald-500/15 text-emerald-700" : "bg-red-500/15 text-red-700"
  }`}>{approved ? "Approved" : "Changes"}</span>;
}

function tone(pct: number): "good" | "warn" | "bad" {
  if (pct >= 80) return "good";
  if (pct >= 50) return "warn";
  return "bad";
}

function toneClass(t: "good" | "warn" | "bad"): string {
  return t === "good" ? "text-emerald-700" : t === "warn" ? "text-amber-700" : "text-red-700";
}
