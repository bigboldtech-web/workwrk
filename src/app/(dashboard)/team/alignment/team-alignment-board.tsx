"use client";

// TeamAlignmentBoard — client island for the /team/alignment member grid.
// The server page handles the access gate + hero stats and hands the
// already-computed members here. This adds:
//   - sort (name / KPI compliance / SOP read-rate / review status)
//   - filter (all / dotted / submitted reviews / mandatory-SOP pending)
//   - inline weekly-review Approve / Request-changes (POST manager-review)
// Type-only import of TeamMember — no prisma leaks into the client bundle.

import { useMemo, useState } from "react";
import Link from "next/link";
import {
  Target, ChartLine, BookOpenCheck, AlertCircle, ChevronRight, GitBranchPlus,
  ClipboardCheck, Clock, CheckCircle2, ArrowUpDown, Loader2, Check, RotateCcw,
} from "lucide-react";
import type { TeamMember } from "@/lib/team-alignment";

type SortKey = "name" | "kpi" | "sop" | "review";
type FilterKey = "all" | "dotted" | "submitted" | "mandatory";

const SORTS: Array<{ key: SortKey; label: string }> = [
  { key: "name", label: "Name" },
  { key: "kpi", label: "KPI compliance" },
  { key: "sop", label: "SOP read-rate" },
  { key: "review", label: "Review status" },
];
const FILTERS: Array<{ key: FilterKey; label: string }> = [
  { key: "all", label: "All" },
  { key: "dotted", label: "Dotted-line" },
  { key: "submitted", label: "Review to action" },
  { key: "mandatory", label: "SOP overdue" },
];

// Order used when sorting by review status — most-urgent first.
const REVIEW_RANK: Record<string, number> = { SUBMITTED: 0, DRAFT: 1, "": 2, ACKNOWLEDGED: 3 };

type ReviewOverride = { status: TeamMember["weeklyReview"]["status"]; managerStatus: TeamMember["weeklyReview"]["managerStatus"] };

export function TeamAlignmentBoard({ members }: { members: TeamMember[] }) {
  const [sort, setSort] = useState<SortKey>("review");
  const [filter, setFilter] = useState<FilterKey>("all");
  // Local overrides so an approved/changed review updates instantly
  // without a full server round-trip + refresh.
  const [overrides, setOverrides] = useState<Record<string, ReviewOverride>>({});

  const effectiveReview = (m: TeamMember): TeamMember["weeklyReview"] => {
    const o = overrides[m.id];
    return o ? { ...m.weeklyReview, ...o } : m.weeklyReview;
  };

  const view = useMemo(() => {
    let list = members.slice();
    if (filter === "dotted") list = list.filter((m) => m.via === "dotted");
    else if (filter === "submitted") list = list.filter((m) => effectiveReview(m).status === "SUBMITTED");
    else if (filter === "mandatory") list = list.filter((m) => m.sops.mandatoryPending > 0);

    list.sort((a, b) => {
      if (sort === "name") return `${a.firstName} ${a.lastName}`.localeCompare(`${b.firstName} ${b.lastName}`);
      if (sort === "kpi") return b.kpis.compliancePct - a.kpis.compliancePct;
      if (sort === "sop") return b.sops.readRatePct - a.sops.readRatePct;
      // review status urgency
      const ra = REVIEW_RANK[effectiveReview(a).status ?? ""] ?? 2;
      const rb = REVIEW_RANK[effectiveReview(b).status ?? ""] ?? 2;
      return ra - rb;
    });
    return list;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [members, filter, sort, overrides]);

  const onActed = (userId: string, override: ReviewOverride) => {
    setOverrides((prev) => ({ ...prev, [userId]: override }));
  };

  return (
    <section>
      <div className="flex items-center justify-between gap-3 mb-2 flex-wrap">
        <h2 className="text-xs uppercase tracking-wide text-zinc-500">Reports · {view.length}</h2>
        <div className="flex items-center gap-2 flex-wrap">
          <div className="flex items-center gap-1">
            {FILTERS.map((f) => (
              <button
                key={f.key}
                type="button"
                onClick={() => setFilter(f.key)}
                className={`h-7 px-2.5 rounded-md text-[12px] border ${
                  filter === f.key ? "border-zinc-900 bg-zinc-900 text-white" : "border-zinc-200 text-zinc-600 hover:bg-zinc-50"
                }`}
              >
                {f.label}
              </button>
            ))}
          </div>
          <label className="inline-flex items-center gap-1.5 h-7 px-2 rounded-md border border-zinc-200 text-[12px] text-zinc-600">
            <ArrowUpDown className="w-3.5 h-3.5 text-zinc-400" />
            <select value={sort} onChange={(e) => setSort(e.target.value as SortKey)} className="bg-transparent outline-none">
              {SORTS.map((s) => <option key={s.key} value={s.key}>{s.label}</option>)}
            </select>
          </label>
        </div>
      </div>

      {view.length === 0 ? (
        <div className="border border-zinc-200 rounded-xl px-6 py-10 text-center text-sm text-zinc-500">
          No reports match this filter.
        </div>
      ) : (
        <ul className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {view.map((m) => (
            <li key={m.id}>
              <MemberCard m={m} review={effectiveReview(m)} onActed={onActed} />
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function MemberCard({
  m, review, onActed,
}: {
  m: TeamMember;
  review: TeamMember["weeklyReview"];
  onActed: (userId: string, o: ReviewOverride) => void;
}) {
  const initials = `${m.firstName?.[0] ?? ""}${m.lastName?.[0] ?? ""}`.toUpperCase() || "?";
  return (
    <article className="rounded-lg border border-zinc-200 bg-white">
      <header className="flex items-center gap-3 px-4 py-3 border-b border-zinc-200">
        <span className="inline-flex items-center justify-center w-9 h-9 rounded-full bg-zinc-100 text-sm font-medium">{initials}</span>
        <div className="flex-1 min-w-0">
          <div className="text-sm font-medium truncate">{m.firstName} {m.lastName}</div>
          <div className="text-xs text-zinc-500 truncate">{m.email}</div>
        </div>
        {m.via === "dotted" ? (
          <span title="Dotted-line report" className="inline-flex items-center gap-1 text-[10px] uppercase tracking-wide px-1.5 py-0.5 rounded bg-zinc-50 text-zinc-500">
            <GitBranchPlus className="w-3 h-3" /> Dotted
          </span>
        ) : null}
        <Link href={`/people/${m.id}`} className="text-zinc-500 hover:text-zinc-900"><ChevronRight className="w-4 h-4" /></Link>
      </header>

      <div className="px-4 py-3 grid grid-cols-2 gap-3">
        <Metric Icon={Target} label="KRAs" value={m.activeKras.length}
          sub={m.activeKras.length > 0 ? m.activeKras.slice(0, 2).map((k) => k.name).join(" · ") : "None assigned"} />
        <Metric Icon={ChartLine} label="KPI compliance" value={`${m.kpis.compliancePct}%`}
          sub={m.kpis.total > 0 ? `${m.kpis.submitted + m.kpis.approved}/${m.kpis.total} on time` : "No KPIs yet"}
          tone={complianceTone(m.kpis.compliancePct)} />
        <Metric Icon={BookOpenCheck} label="SOP read-rate" value={`${m.sops.readRatePct}%`}
          sub={m.sops.total > 0 ? `${m.sops.completed}/${m.sops.total} acknowledged` : "No SOPs assigned"}
          tone={complianceTone(m.sops.readRatePct)} />
        <WeeklyReviewMetric review={review} />
      </div>

      {review.status === "SUBMITTED" && review.id ? (
        <ReviewActions userId={m.id} reviewId={review.id} onActed={onActed} />
      ) : null}

      {m.sops.mandatoryPending > 0 ? (
        <div className="px-4 py-2 border-t border-zinc-200 text-xs text-red-700 bg-red-500/5 flex items-center gap-2">
          <AlertCircle className="w-3 h-3" />
          {m.sops.mandatoryPending} mandatory SOP{m.sops.mandatoryPending === 1 ? "" : "s"} pending
        </div>
      ) : null}
    </article>
  );
}

function ReviewActions({
  userId, reviewId, onActed,
}: { userId: string; reviewId: string; onActed: (userId: string, o: ReviewOverride) => void }) {
  const [busy, setBusy] = useState<null | "approve" | "request_changes">(null);
  const [err, setErr] = useState(false);

  const act = async (action: "approve" | "request_changes") => {
    setBusy(action);
    setErr(false);
    try {
      const res = await fetch(`/api/weekly-reviews/${reviewId}/manager-review`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action }),
      });
      if (!res.ok) { setErr(true); setBusy(null); return; }
      onActed(userId, {
        status: "ACKNOWLEDGED",
        managerStatus: action === "approve" ? "APPROVED" : "CHANGES_REQUESTED",
      });
    } catch {
      setErr(true);
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="px-4 py-2 border-t border-zinc-200 flex items-center gap-2">
      <button
        type="button"
        onClick={() => void act("approve")}
        disabled={busy !== null}
        className="inline-flex items-center gap-1.5 h-7 px-2.5 rounded-md bg-emerald-600 text-white text-[12px] font-medium disabled:opacity-50 hover:bg-emerald-700"
      >
        {busy === "approve" ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Check className="w-3.5 h-3.5" />}
        Approve
      </button>
      <button
        type="button"
        onClick={() => void act("request_changes")}
        disabled={busy !== null}
        className="inline-flex items-center gap-1.5 h-7 px-2.5 rounded-md border border-zinc-200 text-[12px] text-zinc-700 disabled:opacity-50 hover:bg-zinc-50"
      >
        {busy === "request_changes" ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RotateCcw className="w-3.5 h-3.5" />}
        Request changes
      </button>
      <Link href="/team/reviews" className="ml-auto text-[11.5px] text-zinc-400 hover:text-zinc-700">Open review →</Link>
      {err ? <span className="text-[11px] text-red-600">Couldn&apos;t save</span> : null}
    </div>
  );
}

function WeeklyReviewMetric({ review }: { review: TeamMember["weeklyReview"] }) {
  if (!review.status) return <Metric Icon={ClipboardCheck} label="This week's review" value="—" sub="Not started" tone="bad" />;
  if (review.status === "DRAFT") return <Metric Icon={ClipboardCheck} label="This week's review" value="Draft" sub="Not yet submitted" tone="warn" />;
  if (review.status === "SUBMITTED") return <Metric Icon={Clock} label="This week's review" value="Submitted" sub="Awaiting your action" tone="warn" />;
  const approved = review.managerStatus === "APPROVED";
  return <Metric Icon={CheckCircle2} label="This week's review" value={approved ? "Approved" : "Changes"} sub={approved ? "Decided this week" : "Awaiting revision"} tone={approved ? "good" : "bad"} />;
}

function Metric({
  Icon, label, value, sub, tone,
}: {
  Icon: React.ComponentType<{ className?: string }>;
  label: string;
  value: string | number;
  sub: string;
  tone?: "good" | "warn" | "bad";
}) {
  const valueColor = tone === "bad" ? "text-red-600" : tone === "warn" ? "text-amber-600" : tone === "good" ? "text-emerald-600" : undefined;
  return (
    <div>
      <div className="flex items-center gap-1.5 text-[11px] text-zinc-500"><Icon className="w-3 h-3" />{label}</div>
      <div className={`text-base font-semibold ${valueColor ?? ""}`}>{value}</div>
      <div className="text-[11px] text-zinc-500 truncate" title={sub}>{sub}</div>
    </div>
  );
}

function complianceTone(pct: number): "good" | "warn" | "bad" {
  if (pct >= 80) return "good";
  if (pct >= 50) return "warn";
  return "bad";
}
