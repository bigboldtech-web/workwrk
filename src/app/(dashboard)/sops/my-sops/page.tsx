"use client";

/* SOPs · Mine — assigned SOPs for the current user.
 *
 * GET /api/sop-assignments?userId=me
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  BookCopy, Clock, AlertCircle, CheckCircle2, FileText, ListChecks, Video,
  BadgeAlert, Hash, Activity, ClipboardCheck, Layers,
} from "lucide-react";
import { OsTitleBar } from "@/components/layout/os/title-bar";
import { OsEmptyView } from "@/components/layout/os/empty-view";
import { GRAD } from "@/components/layout/os/catalog";
import { useOsShell } from "@/components/layout/os/shell-context";

type Status = "ASSIGNED" | "IN_PROGRESS" | "COMPLETED" | "OVERDUE";
type SopType = "WRITTEN" | "RECORDED" | "CHECKLIST";

type ApiAssignment = {
  id: string; status: Status; mandatory: boolean;
  dueDate?: string | null; stepsTotal: number; stepsCompleted: number; score?: number | null;
  createdAt: string;
  sop?: { id: string; title: string; category?: string | null; status?: string; sopType?: SopType; version?: number } | null;
};

const TYPE_ICON: Record<SopType, React.ComponentType<{ className?: string }>> = {
  WRITTEN: FileText, CHECKLIST: ListChecks, RECORDED: Video,
};
const TYPE_HUE: Record<SopType, string> = {
  WRITTEN: "var(--os-c-teal)", CHECKLIST: "var(--os-c-blue)", RECORDED: "var(--os-c-pink)",
};
const TYPE_LABEL: Record<SopType, string> = {
  WRITTEN: "Written", CHECKLIST: "Checklist", RECORDED: "Screen recording",
};

const MS_DAY = 86_400_000;
function dueChip(a: ApiAssignment): { label: string; tone: "danger" | "warn" | "muted" | "good" } | null {
  if (a.status === "COMPLETED") return { label: "Done", tone: "good" };
  if (!a.dueDate) return null;
  const days = Math.ceil((new Date(a.dueDate).getTime() - Date.now()) / MS_DAY);
  if (days < 0) return { label: `${-days}d late`, tone: "danger" };
  if (days === 0) return { label: "Due today", tone: "warn" };
  if (days <= 3) return { label: `Due in ${days}d`, tone: "warn" };
  return { label: `Due ${new Date(a.dueDate).toLocaleDateString("en-US", { month: "short", day: "numeric" })}`, tone: "muted" };
}

export default function MySopsPage() {
  const [items, setItems] = useState<ApiAssignment[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [showAllDone, setShowAllDone] = useState(false);
  const { rowVersion } = useOsShell();

  const load = useCallback(async () => {
    try {
      const meRes = await fetch("/api/me");
      const me = meRes.ok ? await meRes.json() : null;
      const myId = me?.user?.id ?? null;
      if (!myId) { setLoadError("Couldn't resolve your account."); return; }
      const res = await fetch(`/api/sop-assignments?userId=${encodeURIComponent(myId)}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      setItems(data.data ?? (Array.isArray(data) ? data : []));
      setLoadError(null);
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : "load failed");
    }
  }, []);
  useEffect(() => { void load(); }, [load]);
  const v = rowVersion("sops");
  useEffect(() => { if (v > 0) void load(); }, [v, load]);

  const today0 = Date.now();
  const overdue = useMemo(() => (items ?? []).filter((a) => a.status !== "COMPLETED" && a.dueDate && new Date(a.dueDate).getTime() < today0), [items, today0]);
  const active = useMemo(() => (items ?? []).filter((a) => a.status !== "COMPLETED" && (!a.dueDate || new Date(a.dueDate).getTime() >= today0)), [items, today0]);
  const done = useMemo(() => (items ?? []).filter((a) => a.status === "COMPLETED"), [items]);

  const overdueMand = overdue.filter((a) => a.mandatory).length;
  const totalSteps = (items ?? []).reduce((a, x) => a + (x.stepsTotal ?? 0), 0);
  const completedSteps = (items ?? []).reduce((a, x) => a + (x.stepsCompleted ?? 0), 0);
  const overallPct = totalSteps > 0 ? Math.round((completedSteps / totalSteps) * 100) : 0;

  return (
    <>
      <OsTitleBar
        title="My SOPs"
        Icon={ClipboardCheck}
        iconGradient={GRAD.tealGreen}
        showStandardActions={false}
        description={items === null ? "Loading…" : `${active.length} active · ${overdue.length} overdue · ${done.length} completed · ${overallPct}% steps done`}
        actions={
          <div className="flex items-center gap-2">
            <Link href="/sops" className="inline-flex h-8 items-center gap-1.5 rounded-md border border-zinc-200 px-2.5 text-[13px] text-zinc-700 hover:bg-zinc-50"><Hash className="h-3.5 w-3.5" /> All SOPs</Link>
            <Link href="/sops/compliance" className="inline-flex h-8 items-center gap-1.5 rounded-md border border-zinc-200 px-2.5 text-[13px] text-zinc-700 hover:bg-zinc-50"><Activity className="h-3.5 w-3.5" /> Compliance</Link>
          </div>
        }
      />

      <div className="mys">
        <div className="mys__kpis">
          <KpiTile accent="var(--os-c-red)"    Icon={AlertCircle}   label="Overdue"   value={`${overdue.length}`} sub={overdueMand > 0 ? `${overdueMand} mandatory` : "none mandatory"} />
          <KpiTile accent="var(--os-c-orange)" Icon={Clock}         label="Active"    value={`${active.length}`}  sub="in progress" />
          <KpiTile accent="var(--os-c-green)"  Icon={CheckCircle2}  label="Completed" value={`${done.length}`}    sub="this cycle" />
          <KpiTile accent="var(--os-c-blue)"   Icon={Layers}        label="Step %"    value={`${overallPct}%`}    sub={`${completedSteps} of ${totalSteps}`} />
        </div>

        {loadError ? (
          <OsEmptyView Icon={BookCopy} iconGradient={GRAD.redPink} title="Couldn't load" subtitle={loadError} cta="Retry" />
        ) : items === null ? (
          <div className="mys__loading">Loading…</div>
        ) : (items ?? []).length === 0 ? (
          <OsEmptyView
            Icon={BookCopy}
            iconGradient={GRAD.tealGreen}
            title="No SOPs assigned to you yet"
            subtitle="When a manager assigns a procedure to you, it shows up here with a checklist of steps and a due date."
            chips={["Written", "Checklist", "Recording"]}
          />
        ) : (
          <>
            {overdue.length > 0 && (
              <div className={`mys__banner ${overdueMand > 0 ? "is-danger" : "is-warn"}`}>
                <AlertCircle />
                <span>
                  {overdueMand > 0
                    ? <><strong>{overdueMand} mandatory SOP{overdueMand === 1 ? "" : "s"} overdue.</strong> Address ASAP.</>
                    : <>{overdue.length} SOP{overdue.length === 1 ? "" : "s"} past due date.</>}
                </span>
              </div>
            )}

            {overdue.length > 0 && (
              <Section title="Overdue" Icon={AlertCircle} count={overdue.length} hue="var(--os-c-red)">
                {overdue.map((a) => <SopRow key={a.id} a={a} />)}
              </Section>
            )}

            <Section title="Active" Icon={Clock} count={active.length} hue="var(--os-c-orange)">
              {active.length === 0 ? <div className="mys__empty-soft">Nothing active. Nice work.</div> : active.map((a) => <SopRow key={a.id} a={a} />)}
            </Section>

            {done.length > 0 && (
              <Section title="Completed" Icon={CheckCircle2} count={done.length} hue="var(--os-c-green)">
                {(showAllDone ? done : done.slice(0, 10)).map((a) => <SopRow key={a.id} a={a} />)}
                {done.length > 10 && (
                  <button
                    type="button"
                    onClick={() => setShowAllDone((v) => !v)}
                    className="mt-1.5 text-[12px] text-zinc-500 hover:text-zinc-800 underline underline-offset-2"
                  >
                    {showAllDone ? "Show less" : `View all ${done.length}`}
                  </button>
                )}
              </Section>
            )}
          </>
        )}
      </div>
    </>
  );
}

function Section({ title, Icon, count, hue, children }: { title: string; Icon: typeof Clock; count: number; hue: string; children: React.ReactNode }) {
  return (
    <section className="mys__section" style={{ ["--s-c" as unknown as string]: hue }}>
      <header className="mys__section-head">
        <span className="mys__section-tag"><Icon /> {title}</span>
        <span className="mys__section-count">{count}</span>
        <span className="mys__section-line" />
      </header>
      <div className="mys__list">{children}</div>
    </section>
  );
}

function SopRow({ a }: { a: ApiAssignment }) {
  const Type = a.sop?.sopType ? TYPE_ICON[a.sop.sopType] : FileText;
  const hue = a.sop?.sopType ? TYPE_HUE[a.sop.sopType] : "var(--os-ink-3)";
  const chip = dueChip(a);
  const pct = a.stepsTotal > 0 ? Math.round((a.stepsCompleted / a.stepsTotal) * 100) : 0;
  return (
    <Link href={a.sop?.id ? `/sops/${a.sop.id}` : "/sops"} className={`mys__row${a.status === "COMPLETED" ? " is-done" : ""}`} style={{ ["--r-c" as unknown as string]: hue }}>
      <span className="mys__row-icon"><Type /></span>
      <div className="mys__row-main">
        <div className="mys__row-title">
          {a.sop?.title ?? "Untitled SOP"}
          {a.mandatory && a.status !== "COMPLETED" && <span className="mys__row-mand"><BadgeAlert /> Mandatory</span>}
        </div>
        <div className="mys__row-meta">
          {a.sop?.sopType && <span>{TYPE_LABEL[a.sop.sopType]}</span>}
          {a.sop?.category && <span>· {a.sop.category}</span>}
          {a.sop?.version && <span>· v{a.sop.version}</span>}
        </div>
        {a.status !== "COMPLETED" && a.stepsTotal > 0 && (
          <div className="mys__row-bar"><div className="mys__row-bar-fill" style={{ width: `${pct}%` }} /></div>
        )}
      </div>
      <div className="mys__row-right">
        {a.status !== "COMPLETED" && a.stepsTotal > 0 && <span className="mys__row-pct">{pct}%</span>}
        {chip && <span className={`mys__row-chip mys__row-chip--${chip.tone}`}>{chip.label}</span>}
      </div>
    </Link>
  );
}

function KpiTile({ accent, Icon, label, value, sub }: { accent: string; Icon: typeof BookCopy; label: string; value: string; sub: string }) {
  return (
    <div className="mys__kpi" style={{ ["--kpi-accent" as unknown as string]: accent }}>
      <span className="mys__kpi-accent" aria-hidden="true" />
      <div className="mys__kpi-row">
        <div className="mys__kpi-icon"><Icon /></div>
        <div className="mys__kpi-label">{label}</div>
      </div>
      <div className="mys__kpi-value">{value}</div>
      <div className="mys__kpi-sub">{sub}</div>
    </div>
  );
}
