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
import { getTeamAlignment, type TeamMember } from "@/lib/team-alignment";
import Link from "next/link";
import {
  Target, ChartLine, BookOpenCheck, Users as UsersIcon, AlertCircle, ChevronRight, GitBranchPlus,
  ClipboardCheck, Clock, CheckCircle2,
} from "lucide-react";

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
          <div className="flex items-center gap-2 text-sm text-muted mb-2">
            <UsersIcon className="w-3.5 h-3.5" />
            <span>Team</span>
            <span>/</span>
            <span>Alignment</span>
          </div>
          <h1 className="text-2xl font-semibold">Team alignment</h1>
          <p className="text-sm text-muted mt-1 max-w-[640px]">
            Your direct and dotted-line reports — what they own, how they're tracking, what they owe.
          </p>
        </div>
        <div className="flex items-center gap-2">
          {/* Director rollup link — director gate enforced server-side
              on /team/rollup; rendered for everyone but redirects
              non-directors back here. */}
          <Link
            href="/team/rollup"
            className="inline-flex items-center gap-1.5 h-8 px-3 rounded-md text-sm border border-border hover:bg-surface-2"
          >
            <UsersIcon className="w-3.5 h-3.5" />
            Director rollup
          </Link>
          <Link
            href="/team/reviews"
            className="inline-flex items-center gap-1.5 h-8 px-3 rounded-md text-sm border border-border hover:bg-surface-2"
          >
            <ClipboardCheck className="w-3.5 h-3.5" />
            Weekly reviews
            <ChevronRight className="w-3 h-3" />
          </Link>
        </div>
      </header>

      {data.members.length === 0 ? (
        <div className="border border-border rounded-xl px-8 py-16 text-center">
          <UsersIcon className="w-8 h-8 mx-auto text-muted mb-3" />
          <div className="text-base font-medium mb-1">No reports yet</div>
          <p className="text-sm text-muted max-w-[420px] mx-auto">
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

          <section>
            <h2 className="text-xs uppercase tracking-wide text-muted mb-2">Reports</h2>
            <ul className="grid grid-cols-1 md:grid-cols-2 gap-3">
              {data.members.map((m) => (
                <li key={m.id}>
                  <MemberCard m={m} />
                </li>
              ))}
            </ul>
          </section>
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
    <div className="rounded-lg border border-border bg-surface px-4 py-3">
      <div className="flex items-center gap-1.5 text-xs text-muted">
        <Icon className="w-3.5 h-3.5" />
        {label}
      </div>
      <div className={`text-2xl font-semibold mt-1 ${valueColor ?? ""}`}>{value}</div>
    </div>
  );
}

function MemberCard({ m }: { m: TeamMember }) {
  const initials = `${m.firstName?.[0] ?? ""}${m.lastName?.[0] ?? ""}`.toUpperCase() || "?";
  return (
    <article className="rounded-lg border border-border bg-surface">
      <header className="flex items-center gap-3 px-4 py-3 border-b border-border">
        <span className="inline-flex items-center justify-center w-9 h-9 rounded-full bg-surface-3 text-sm font-medium">
          {initials}
        </span>
        <div className="flex-1 min-w-0">
          <div className="text-sm font-medium truncate">
            {m.firstName} {m.lastName}
          </div>
          <div className="text-xs text-muted truncate">{m.email}</div>
        </div>
        {m.via === "dotted" ? (
          <span
            title="Dotted-line report"
            className="inline-flex items-center gap-1 text-[10px] uppercase tracking-wide px-1.5 py-0.5 rounded bg-surface-2 text-muted"
          >
            <GitBranchPlus className="w-3 h-3" /> Dotted
          </span>
        ) : null}
        <Link href={`/people/${m.id}`} className="text-muted hover:text-foreground">
          <ChevronRight className="w-4 h-4" />
        </Link>
      </header>

      <div className="px-4 py-3 grid grid-cols-2 gap-3">
        <Metric
          Icon={Target}
          label="KRAs"
          value={m.activeKras.length}
          sub={m.activeKras.length > 0 ? m.activeKras.slice(0, 2).map((k) => k.name).join(" · ") : "None assigned"}
        />
        <Metric
          Icon={ChartLine}
          label="KPI compliance"
          value={`${m.kpis.compliancePct}%`}
          sub={m.kpis.total > 0
            ? `${m.kpis.submitted + m.kpis.approved}/${m.kpis.total} on time`
            : "No KPIs yet"}
          tone={complianceTone(m.kpis.compliancePct)}
        />
        <Metric
          Icon={BookOpenCheck}
          label="SOP read-rate"
          value={`${m.sops.readRatePct}%`}
          sub={m.sops.total > 0
            ? `${m.sops.completed}/${m.sops.total} acknowledged`
            : "No SOPs assigned"}
          tone={complianceTone(m.sops.readRatePct)}
        />
        <WeeklyReviewMetric review={m.weeklyReview} />
      </div>
      {m.sops.mandatoryPending > 0 ? (
        <div className="px-4 py-2 border-t border-border text-xs text-red-700 bg-red-500/5 flex items-center gap-2">
          <AlertCircle className="w-3 h-3" />
          {m.sops.mandatoryPending} mandatory SOP{m.sops.mandatoryPending === 1 ? "" : "s"} pending
        </div>
      ) : null}
    </article>
  );
}

function WeeklyReviewMetric({ review }: { review: TeamMember["weeklyReview"] }) {
  if (!review.status) {
    return (
      <Metric
        Icon={ClipboardCheck}
        label="This week's review"
        value="—"
        sub="Not started"
        tone="bad"
      />
    );
  }
  if (review.status === "DRAFT") {
    return (
      <Metric
        Icon={ClipboardCheck}
        label="This week's review"
        value="Draft"
        sub="Not yet submitted"
        tone="warn"
      />
    );
  }
  if (review.status === "SUBMITTED") {
    return (
      <Metric
        Icon={Clock}
        label="This week's review"
        value="Submitted"
        sub="Awaiting your action"
        tone="warn"
      />
    );
  }
  // ACKNOWLEDGED
  const approved = review.managerStatus === "APPROVED";
  return (
    <Metric
      Icon={CheckCircle2}
      label="This week's review"
      value={approved ? "Approved" : "Changes"}
      sub={approved ? "Decided this week" : "Awaiting revision"}
      tone={approved ? "good" : "bad"}
    />
  );
}

function Metric({
  Icon,
  label,
  value,
  sub,
  tone,
}: {
  Icon: React.ComponentType<{ className?: string }>;
  label: string;
  value: string | number;
  sub: string;
  tone?: "good" | "warn" | "bad";
}) {
  const valueColor =
    tone === "bad" ? "text-red-600" :
    tone === "warn" ? "text-amber-600" :
    tone === "good" ? "text-emerald-600" :
    undefined;
  return (
    <div>
      <div className="flex items-center gap-1.5 text-[11px] text-muted">
        <Icon className="w-3 h-3" />
        {label}
      </div>
      <div className={`text-base font-semibold ${valueColor ?? ""}`}>{value}</div>
      <div className="text-[11px] text-muted truncate" title={sub}>{sub}</div>
    </div>
  );
}

function complianceTone(pct: number): "good" | "warn" | "bad" {
  if (pct >= 80) return "good";
  if (pct >= 50) return "warn";
  return "bad";
}
