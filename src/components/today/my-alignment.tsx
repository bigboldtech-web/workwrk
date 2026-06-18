"use client";

// MyAlignment — the Phase 4 "your KRAs, your KPIs, your SOPs" block
// pinned to the top of /today. Surfaces the gating substrate so every
// user lands on a personalized AI-OS home before they touch tasks.
//
// Three sections:
//   1. KRAs    — cards keyed by KRAAssignment.userId = you
//   2. KPIs to score — KPIRecord rows with status PENDING or REJECTED
//   3. SOPs to acknowledge — SOPAssignment rows not COMPLETED
//
// Visible-by-default; the block hides if all three are empty (a brand-
// new user with no assignments shouldn't see a sea of blanks).

import { useEffect, useState } from "react";
import Link from "next/link";
import {
  Target, ChartLine, BookOpenCheck, ArrowRight, AlertCircle, ChevronRight,
  ClipboardCheck, CheckCircle2, Clock, ListChecks, ShieldCheck,
} from "lucide-react";
import { KpiScoreModal } from "./kpi-score-modal";
import { SopAckModal } from "./sop-ack-modal";

interface KraRow {
  assignmentId: string;
  weightage: number;
  period: string | null;
  kra: {
    id: string;
    name: string;
    description: string | null;
    category: string | null;
    kpis: Array<{ id: string; name: string; unit: string | null; frequency: string; targetValue: number | null; lowerIsBetter: boolean }>;
    teamSize: number;
  };
}

interface KpiPrompt {
  id: string;
  period: string;
  status: string;
  targetValue: number | null;
  actualValue: number | null;
  score: number | null;
  kpi: { id: string; name: string; unit: string | null; frequency: string; targetValue: number | null; lowerIsBetter: boolean };
}

interface SopRow {
  assignmentId: string;
  status: string;
  mandatory: boolean;
  pending: boolean;
  sop: { id: string; title: string; description: string | null; status: string };
}

interface RunRow {
  id: string;
  title: string;
  status: string;
  progress: number;
  dueDate: string | null;
  shareToken: string | null;
  sopId: string | null;
  sopTitle: string | null;
}

interface PolicyTodo {
  assignmentId: string;
  policyId: string;
  title: string;
  mandatory: boolean;
  dueDate: string | null;
  status: string;
}

interface WeeklyReviewLite {
  id: string;
  status: "DRAFT" | "SUBMITTED" | "ACKNOWLEDGED";
  periodStart: string;
  managerStatus: "PENDING" | "APPROVED" | "CHANGES_REQUESTED" | null;
}

export function MyAlignment() {
  const [kras, setKras] = useState<KraRow[]>([]);
  const [prompts, setPrompts] = useState<KpiPrompt[]>([]);
  const [sops, setSops] = useState<SopRow[]>([]);
  const [runs, setRuns] = useState<RunRow[]>([]);
  const [policies, setPolicies] = useState<PolicyTodo[]>([]);
  const [weekly, setWeekly] = useState<WeeklyReviewLite | null>(null);
  const [loading, setLoading] = useState(true);
  const [activeKpi, setActiveKpi] = useState<KpiPrompt | null>(null);
  const [activeSop, setActiveSop] = useState<SopRow | null>(null);

  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const [kRes, pRes, sRes, rRes, polRes, wRes] = await Promise.all([
          fetch("/api/me/kras",          { cache: "no-store" }),
          fetch("/api/me/kpi-prompts",   { cache: "no-store" }),
          fetch("/api/me/sops",          { cache: "no-store" }),
          fetch("/api/me/process-runs",  { cache: "no-store" }),
          fetch("/api/me/policies",      { cache: "no-store" }),
          fetch("/api/me/weekly-review", { cache: "no-store" }),
        ]);
        if (!active) return;
        if (kRes.ok) setKras((await kRes.json()).kras ?? []);
        if (pRes.ok) setPrompts((await pRes.json()).prompts ?? []);
        if (sRes.ok) setSops((await sRes.json()).sops ?? []);
        if (rRes.ok) setRuns((await rRes.json()).runs ?? []);
        if (polRes.ok) setPolicies((await polRes.json()).policies ?? []);
        if (wRes.ok) {
          const data = await wRes.json();
          if (data.review) {
            setWeekly({
              id: data.review.id,
              status: data.review.status,
              periodStart: data.review.periodStart,
              managerStatus: data.review.managerStatus,
            });
          }
        }
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => { active = false; };
  }, []);

  const pendingSops = sops.filter((s) => s.pending);
  const mandatoryPending = pendingSops.filter((s) => s.mandatory);

  // If totally empty (no assignments + no weekly review yet), don't
  // show the block — keeps /today clean for new orgs that haven't
  // seeded yet.
  if (!loading && kras.length === 0 && prompts.length === 0 && sops.length === 0 && runs.length === 0 && policies.length === 0 && !weekly) {
    return null;
  }

  return (
    <section className="mb-6 space-y-4">
      <header className="flex items-end justify-between">
        <div>
          <h2 className="text-base font-semibold flex items-center gap-2">
            <Target className="w-4 h-4 text-[var(--os-brand)]" />
            Your alignment
          </h2>
          <p className="text-xs text-zinc-500 mt-0.5">
            What the org expects of you — KRAs, KPIs to score, SOPs to acknowledge.
          </p>
        </div>
        <Link href="/kra-kpi" className="text-xs text-zinc-500 hover:text-zinc-900 inline-flex items-center gap-1">
          Open KRA &amp; KPI <ChevronRight className="w-3 h-3" />
        </Link>
      </header>

      {weekly ? <WeeklyReviewCallout w={weekly} /> : null}

      {mandatoryPending.length > 0 ? (
        <div className="rounded-md border border-amber-500/40 bg-amber-500/10 px-4 py-3 flex items-center gap-3">
          <AlertCircle className="w-4 h-4 text-amber-600 flex-shrink-0" />
          <div className="flex-1 text-sm">
            <span className="font-medium">{mandatoryPending.length} mandatory SOP{mandatoryPending.length === 1 ? "" : "s"}</span>{" "}
            <span className="text-zinc-500">awaiting your acknowledgement.</span>
          </div>
          <Link href="/sops" className="text-xs font-medium text-amber-700 hover:text-amber-800 inline-flex items-center gap-1">
            Review <ArrowRight className="w-3 h-3" />
          </Link>
        </div>
      ) : null}

      {policies.length > 0 ? (
        <div className="rounded-md border border-zinc-200 bg-white">
          <div className="flex items-center gap-2 border-b border-zinc-100 px-4 py-2.5">
            <ShieldCheck className="w-4 h-4 text-[var(--os-brand)]" />
            <span className="text-sm font-medium">Policies to acknowledge</span>
            <span className="text-xs text-zinc-400">{policies.length}</span>
          </div>
          <ul className="divide-y divide-zinc-100">
            {policies.map((p) => (
              <li key={p.assignmentId}>
                <Link href={`/policies/${p.policyId}`} className="flex items-center gap-3 px-4 py-2.5 hover:bg-zinc-50">
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-medium">{p.title}</div>
                    <div className="mt-0.5 flex items-center gap-2 text-xs text-zinc-400">
                      {p.mandatory ? <span className="font-medium text-amber-600">Mandatory</span> : <span>Optional</span>}
                      {p.dueDate ? <span>· Due {new Date(p.dueDate).toLocaleDateString()}</span> : null}
                    </div>
                  </div>
                  <ArrowRight className="w-4 h-4 text-zinc-400" />
                </Link>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {runs.length > 0 ? (
        <div className="rounded-md border border-zinc-200 bg-white">
          <div className="flex items-center gap-2 border-b border-zinc-100 px-4 py-2.5">
            <ListChecks className="w-4 h-4 text-[var(--os-brand)]" />
            <span className="text-sm font-medium">Checklists to run</span>
            <span className="text-xs text-zinc-400">{runs.length}</span>
          </div>
          <ul className="divide-y divide-zinc-100">
            {runs.map((r) => (
              <li key={r.id}>
                <Link
                  href={r.shareToken ? `/run/${r.shareToken}` : "/process-runs"}
                  className="flex items-center gap-3 px-4 py-2.5 hover:bg-zinc-50"
                >
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-medium">{r.title || r.sopTitle || "Checklist"}</div>
                    <div className="mt-1 flex items-center gap-2">
                      <div className="h-1.5 w-24 overflow-hidden rounded-full bg-zinc-100">
                        <div className="h-full rounded-full bg-[var(--os-brand)]" style={{ width: `${r.progress}%` }} />
                      </div>
                      <span className="text-xs text-zinc-400">{r.progress}%</span>
                      {r.status === "OVERDUE" ? <span className="text-xs font-medium text-red-600">Overdue</span> : null}
                    </div>
                  </div>
                  <ArrowRight className="w-4 h-4 text-zinc-400" />
                </Link>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        <KraColumn kras={kras} loading={loading} />
        <KpiColumn prompts={prompts} loading={loading} onPick={setActiveKpi} />
        <SopColumn sops={pendingSops} loading={loading} onPick={setActiveSop} />
      </div>

      <KpiScoreModal
        open={!!activeKpi}
        prompt={activeKpi}
        onOpenChange={(v) => { if (!v) setActiveKpi(null); }}
        onScored={(id) => setPrompts((prev) => prev.filter((p) => p.id !== id))}
      />
      <SopAckModal
        open={!!activeSop}
        sop={activeSop}
        onOpenChange={(v) => { if (!v) setActiveSop(null); }}
        onAcked={(assignmentId) => {
          setSops((prev) =>
            prev.map((s) => (s.assignmentId === assignmentId ? { ...s, status: "COMPLETED", pending: false } : s)),
          );
        }}
      />
    </section>
  );
}

function WeeklyReviewCallout({ w }: { w: WeeklyReviewLite }) {
  const day = new Date().getUTCDay(); // 0=Sun, 5=Fri
  const isFridayOrAfter = day === 0 || day === 5 || day === 6;
  if (w.status === "DRAFT") {
    return (
      <Link
        href="/me/weekly-review"
        className={`rounded-md border px-4 py-3 flex items-center gap-3 hover:bg-zinc-50 ${
          isFridayOrAfter ? "border-amber-500/40 bg-amber-500/10" : "border-zinc-200 bg-white"
        }`}
      >
        <ClipboardCheck className={`w-4 h-4 ${isFridayOrAfter ? "text-amber-600" : "text-zinc-500"}`} />
        <div className="flex-1 text-sm">
          <div className="font-medium">Weekly review — draft</div>
          <div className="text-xs text-zinc-500">
            {isFridayOrAfter ? "Friday. Submit your week before EOD." : "Fill it in as the week unfolds; submit by Friday."}
          </div>
        </div>
        <ArrowRight className="w-4 h-4 text-zinc-500" />
      </Link>
    );
  }
  if (w.status === "SUBMITTED") {
    return (
      <Link
        href="/me/weekly-review"
        className="rounded-md border border-zinc-200 bg-white px-4 py-3 flex items-center gap-3 hover:bg-zinc-50"
      >
        <Clock className="w-4 h-4 text-zinc-500" />
        <div className="flex-1 text-sm">
          <div className="font-medium">Weekly review — submitted</div>
          <div className="text-xs text-zinc-500">Awaiting manager acknowledgement.</div>
        </div>
      </Link>
    );
  }
  // ACKNOWLEDGED
  const approved = w.managerStatus === "APPROVED";
  return (
    <Link
      href="/me/weekly-review"
      className={`rounded-md border px-4 py-3 flex items-center gap-3 hover:bg-zinc-50 ${
        approved ? "border-emerald-500/30 bg-emerald-500/5" : "border-red-500/30 bg-red-500/5"
      }`}
    >
      {approved ? <CheckCircle2 className="w-4 h-4 text-emerald-700" /> : <AlertCircle className="w-4 h-4 text-red-700" />}
      <div className="flex-1 text-sm">
        <div className="font-medium">
          {approved ? "Weekly review — approved" : "Weekly review — changes requested"}
        </div>
        <div className="text-xs text-zinc-500">
          {approved ? "Manager approved this week." : "Manager wants you to revise + resubmit."}
        </div>
      </div>
    </Link>
  );
}

function KraColumn({ kras, loading }: { kras: KraRow[]; loading: boolean }) {
  return (
    <div className="rounded-lg border border-zinc-200 bg-white">
      <ColumnHeader Icon={Target} label="Your KRAs" count={kras.length} href="/kra-kpi" />
      {loading && kras.length === 0 ? (
        <div className="px-4 py-3 text-xs text-zinc-500">Loading…</div>
      ) : kras.length === 0 ? (
        <div className="px-4 py-3 text-xs text-zinc-500">No KRAs assigned yet.</div>
      ) : (
        <ul className="px-2 py-1.5 max-h-[260px] overflow-y-auto">
          {kras.slice(0, 8).map((row) => (
            <li key={row.assignmentId} className="px-2 py-1.5 rounded-md hover:bg-zinc-50">
              <div className="flex items-center gap-2 text-sm">
                <span className="truncate flex-1">{row.kra.name}</span>
                {row.weightage > 0 ? (
                  <span className="text-[10px] uppercase tracking-wide text-zinc-500">{Math.round(row.weightage)}%</span>
                ) : null}
              </div>
              {row.kra.category || row.kra.kpis.length > 0 ? (
                <div className="text-[11px] text-zinc-500 truncate">
                  {row.kra.category ? <span>{row.kra.category}</span> : null}
                  {row.kra.category && row.kra.kpis.length > 0 ? <span> · </span> : null}
                  {row.kra.kpis.length > 0 ? <span>{row.kra.kpis.length} KPI{row.kra.kpis.length === 1 ? "" : "s"}</span> : null}
                </div>
              ) : null}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function KpiColumn({
  prompts,
  loading,
  onPick,
}: {
  prompts: KpiPrompt[];
  loading: boolean;
  onPick: (p: KpiPrompt) => void;
}) {
  return (
    <div className="rounded-lg border border-zinc-200 bg-white">
      <ColumnHeader Icon={ChartLine} label="KPIs to score" count={prompts.length} href="/kra-kpi" />
      {loading && prompts.length === 0 ? (
        <div className="px-4 py-3 text-xs text-zinc-500">Loading…</div>
      ) : prompts.length === 0 ? (
        <div className="px-4 py-3 text-xs text-zinc-500">All caught up.</div>
      ) : (
        <ul className="px-2 py-1.5 max-h-[260px] overflow-y-auto">
          {prompts.slice(0, 8).map((p) => (
            <li key={p.id}>
              <button
                type="button"
                onClick={() => onPick(p)}
                className="w-full text-left px-2 py-1.5 rounded-md hover:bg-zinc-50"
              >
                <div className="flex items-center gap-2 text-sm">
                  <span className="truncate flex-1">{p.kpi.name}</span>
                  <span
                    className={`text-[10px] uppercase tracking-wide px-1.5 py-0.5 rounded ${
                      p.status === "REJECTED"
                        ? "bg-red-500/15 text-red-600"
                        : "bg-amber-500/15 text-amber-700"
                    }`}
                  >
                    {p.status === "REJECTED" ? "Rework" : "Score"}
                  </span>
                </div>
                <div className="text-[11px] text-zinc-500 truncate">
                  {p.period} · target {p.targetValue ?? "—"}{p.kpi.unit ? ` ${p.kpi.unit}` : ""} · {p.kpi.frequency.toLowerCase()}
                </div>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function SopColumn({
  sops,
  loading,
  onPick,
}: {
  sops: SopRow[];
  loading: boolean;
  onPick: (s: SopRow) => void;
}) {
  return (
    <div className="rounded-lg border border-zinc-200 bg-white">
      <ColumnHeader Icon={BookOpenCheck} label="SOPs to acknowledge" count={sops.length} href="/sops" />
      {loading && sops.length === 0 ? (
        <div className="px-4 py-3 text-xs text-zinc-500">Loading…</div>
      ) : sops.length === 0 ? (
        <div className="px-4 py-3 text-xs text-zinc-500">All acknowledged.</div>
      ) : (
        <ul className="px-2 py-1.5 max-h-[260px] overflow-y-auto">
          {sops.slice(0, 8).map((row) => (
            <li key={row.assignmentId}>
              <button
                type="button"
                onClick={() => onPick(row)}
                className="w-full text-left px-2 py-1.5 rounded-md hover:bg-zinc-50"
              >
                <div className="flex items-center gap-2 text-sm">
                  <span className="truncate flex-1">{row.sop.title}</span>
                  {row.mandatory ? (
                    <span className="text-[10px] uppercase tracking-wide px-1.5 py-0.5 rounded bg-red-500/15 text-red-600">
                      Mandatory
                    </span>
                  ) : null}
                </div>
                <div className="text-[11px] text-zinc-500 truncate">{row.status.toLowerCase().replace(/_/g, " ")}</div>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function ColumnHeader({
  Icon,
  label,
  count,
  href,
}: {
  Icon: React.ComponentType<{ className?: string }>;
  label: string;
  count: number;
  href: string;
}) {
  return (
    <div className="flex items-center gap-2 px-3 py-2 border-b border-zinc-200">
      <Icon className="w-3.5 h-3.5 text-zinc-500" />
      <span className="text-xs font-medium flex-1">{label}</span>
      <span className="text-xs text-zinc-500">{count}</span>
      <Link href={href} className="text-zinc-500 hover:text-zinc-900">
        <ChevronRight className="w-3.5 h-3.5" />
      </Link>
    </div>
  );
}
