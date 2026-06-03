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

export function MyAlignment() {
  const [kras, setKras] = useState<KraRow[]>([]);
  const [prompts, setPrompts] = useState<KpiPrompt[]>([]);
  const [sops, setSops] = useState<SopRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeKpi, setActiveKpi] = useState<KpiPrompt | null>(null);
  const [activeSop, setActiveSop] = useState<SopRow | null>(null);

  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const [kRes, pRes, sRes] = await Promise.all([
          fetch("/api/me/kras",         { cache: "no-store" }),
          fetch("/api/me/kpi-prompts",  { cache: "no-store" }),
          fetch("/api/me/sops",         { cache: "no-store" }),
        ]);
        if (!active) return;
        if (kRes.ok) setKras((await kRes.json()).kras ?? []);
        if (pRes.ok) setPrompts((await pRes.json()).prompts ?? []);
        if (sRes.ok) setSops((await sRes.json()).sops ?? []);
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => { active = false; };
  }, []);

  const pendingSops = sops.filter((s) => s.pending);
  const mandatoryPending = pendingSops.filter((s) => s.mandatory);

  // If totally empty (no assignments), don't show the block — keeps
  // /today clean for new orgs that haven't seeded yet.
  if (!loading && kras.length === 0 && prompts.length === 0 && sops.length === 0) {
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
          <p className="text-xs text-muted mt-0.5">
            What the org expects of you — KRAs, KPIs to score, SOPs to acknowledge.
          </p>
        </div>
        <Link href="/kra-kpi" className="text-xs text-muted hover:text-foreground inline-flex items-center gap-1">
          Open KRA &amp; KPI <ChevronRight className="w-3 h-3" />
        </Link>
      </header>

      {mandatoryPending.length > 0 ? (
        <div className="rounded-md border border-amber-500/40 bg-amber-500/10 px-4 py-3 flex items-center gap-3">
          <AlertCircle className="w-4 h-4 text-amber-600 flex-shrink-0" />
          <div className="flex-1 text-sm">
            <span className="font-medium">{mandatoryPending.length} mandatory SOP{mandatoryPending.length === 1 ? "" : "s"}</span>{" "}
            <span className="text-muted">awaiting your acknowledgement.</span>
          </div>
          <Link href="/sops" className="text-xs font-medium text-amber-700 hover:text-amber-800 inline-flex items-center gap-1">
            Review <ArrowRight className="w-3 h-3" />
          </Link>
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

function KraColumn({ kras, loading }: { kras: KraRow[]; loading: boolean }) {
  return (
    <div className="rounded-lg border border-border bg-surface">
      <ColumnHeader Icon={Target} label="Your KRAs" count={kras.length} href="/kra-kpi" />
      {loading && kras.length === 0 ? (
        <div className="px-4 py-3 text-xs text-muted">Loading…</div>
      ) : kras.length === 0 ? (
        <div className="px-4 py-3 text-xs text-muted">No KRAs assigned yet.</div>
      ) : (
        <ul className="px-2 py-1.5 max-h-[260px] overflow-y-auto">
          {kras.slice(0, 8).map((row) => (
            <li key={row.assignmentId} className="px-2 py-1.5 rounded-md hover:bg-surface-2">
              <div className="flex items-center gap-2 text-sm">
                <span className="truncate flex-1">{row.kra.name}</span>
                {row.weightage > 0 ? (
                  <span className="text-[10px] uppercase tracking-wide text-muted">{Math.round(row.weightage)}%</span>
                ) : null}
              </div>
              {row.kra.category || row.kra.kpis.length > 0 ? (
                <div className="text-[11px] text-muted truncate">
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
    <div className="rounded-lg border border-border bg-surface">
      <ColumnHeader Icon={ChartLine} label="KPIs to score" count={prompts.length} href="/kra-kpi" />
      {loading && prompts.length === 0 ? (
        <div className="px-4 py-3 text-xs text-muted">Loading…</div>
      ) : prompts.length === 0 ? (
        <div className="px-4 py-3 text-xs text-muted">All caught up.</div>
      ) : (
        <ul className="px-2 py-1.5 max-h-[260px] overflow-y-auto">
          {prompts.slice(0, 8).map((p) => (
            <li key={p.id}>
              <button
                type="button"
                onClick={() => onPick(p)}
                className="w-full text-left px-2 py-1.5 rounded-md hover:bg-surface-2"
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
                <div className="text-[11px] text-muted truncate">
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
    <div className="rounded-lg border border-border bg-surface">
      <ColumnHeader Icon={BookOpenCheck} label="SOPs to acknowledge" count={sops.length} href="/sops" />
      {loading && sops.length === 0 ? (
        <div className="px-4 py-3 text-xs text-muted">Loading…</div>
      ) : sops.length === 0 ? (
        <div className="px-4 py-3 text-xs text-muted">All acknowledged.</div>
      ) : (
        <ul className="px-2 py-1.5 max-h-[260px] overflow-y-auto">
          {sops.slice(0, 8).map((row) => (
            <li key={row.assignmentId}>
              <button
                type="button"
                onClick={() => onPick(row)}
                className="w-full text-left px-2 py-1.5 rounded-md hover:bg-surface-2"
              >
                <div className="flex items-center gap-2 text-sm">
                  <span className="truncate flex-1">{row.sop.title}</span>
                  {row.mandatory ? (
                    <span className="text-[10px] uppercase tracking-wide px-1.5 py-0.5 rounded bg-red-500/15 text-red-600">
                      Mandatory
                    </span>
                  ) : null}
                </div>
                <div className="text-[11px] text-muted truncate">{row.status.toLowerCase().replace(/_/g, " ")}</div>
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
    <div className="flex items-center gap-2 px-3 py-2 border-b border-border">
      <Icon className="w-3.5 h-3.5 text-muted" />
      <span className="text-xs font-medium flex-1">{label}</span>
      <span className="text-xs text-muted">{count}</span>
      <Link href={href} className="text-muted hover:text-foreground">
        <ChevronRight className="w-3.5 h-3.5" />
      </Link>
    </div>
  );
}
