"use client";

/* SOPs · Mine — assigned SOPs for the current user.
 *
 * Three buckets: Overdue (red urgency banner) · Active (progress bars)
 * · Completed (collapsed, last 10). Each row: SOP title, category,
 * type (Written/Checklist/Recording), due date, completion %, mandatory
 * badge. Clicking a row opens /sops/[id].
 *
 * GET /api/sop-assignments?userId=me
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { BookCopy, Clock, AlertCircle, CheckCircle2, FileText, ListChecks, Video, BadgeAlert } from "lucide-react";
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
  const [meId, setMeId] = useState<string | null>(null);
  const [items, setItems] = useState<ApiAssignment[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const { rowVersion } = useOsShell();

  const load = useCallback(async () => {
    try {
      const meRes = await fetch("/api/me");
      const me = meRes.ok ? await meRes.json() : null;
      const myId = me?.user?.id ?? null;
      setMeId(myId);
      if (!myId) { setLoadError("Couldn't resolve your account."); return; }
      const res = await fetch(`/api/sop-assignments?userId=${encodeURIComponent(myId)}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      setItems(data.data ?? (Array.isArray(data) ? data : []));
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

  return (
    <div className="mysops">
      <header className="mysops__head">
        <div className="mysops__head-l">
          <div className="mysops__icon" style={{ background: "linear-gradient(135deg, var(--os-c-teal), var(--os-c-green))" }}><BookCopy /></div>
          <div>
            <h1 className="mysops__title">My SOPs</h1>
            <div className="mysops__sub">
              {items === null ? "Loading…" : `${active.length} active · ${overdue.length} overdue · ${done.length} completed`}
            </div>
          </div>
        </div>
        <Link href="/sops" className="mysops__link">All SOPs →</Link>
      </header>

      {loadError ? (
        <div className="mysops__error">{loadError}</div>
      ) : items === null ? (
        <div style={{ padding: 60, textAlign: "center", color: "var(--os-ink-3)", fontSize: 13 }}>Loading…</div>
      ) : (items ?? []).length === 0 ? (
        <div className="mysops__empty">
          <BookCopy />
          <div>
            <h3>No SOPs assigned to you yet</h3>
            <p>When a manager assigns a procedure to you, it shows up here with a checklist of steps and a due date.</p>
          </div>
        </div>
      ) : (
        <>
          {overdue.length > 0 && (
            <div className={`mysops__banner ${overdueMand > 0 ? "is-danger" : "is-warn"}`}>
              <AlertCircle />
              <span>
                {overdueMand > 0
                  ? <><strong>{overdueMand} mandatory SOP{overdueMand === 1 ? "" : "s"} overdue.</strong> Address ASAP.</>
                  : <>{overdue.length} SOP{overdue.length === 1 ? "" : "s"} past due date.</>}
              </span>
            </div>
          )}

          {overdue.length > 0 && (
            <section className="mysops__section">
              <header><AlertCircle style={{ color: "var(--os-c-red)" }} /> <h2>Overdue</h2><span>{overdue.length}</span></header>
              <div className="mysops__list">{overdue.map((a) => <SopRow key={a.id} a={a} />)}</div>
            </section>
          )}

          <section className="mysops__section">
            <header><Clock /> <h2>Active</h2><span>{active.length}</span></header>
            {active.length === 0 ? (
              <div className="mysops__empty-soft">Nothing active. Nice work.</div>
            ) : (
              <div className="mysops__list">{active.map((a) => <SopRow key={a.id} a={a} />)}</div>
            )}
          </section>

          {done.length > 0 && (
            <section className="mysops__section">
              <header><CheckCircle2 style={{ color: "var(--os-c-green)" }} /> <h2>Completed</h2><span>{done.length}</span></header>
              <div className="mysops__list">{done.slice(0, 10).map((a) => <SopRow key={a.id} a={a} />)}</div>
            </section>
          )}
        </>
      )}
    </div>
  );
}

function SopRow({ a }: { a: ApiAssignment }) {
  const Type = a.sop?.sopType ? TYPE_ICON[a.sop.sopType] : FileText;
  const hue = a.sop?.sopType ? TYPE_HUE[a.sop.sopType] : "var(--os-c-darkgray)";
  const chip = dueChip(a);
  const pct = a.stepsTotal > 0 ? Math.round((a.stepsCompleted / a.stepsTotal) * 100) : 0;
  return (
    <Link href={a.sop?.id ? `/sops/${a.sop.id}` : "/sops"} className={`sop-row ${a.status === "COMPLETED" ? "is-done" : ""}`}>
      <span className="sop-row__icon" style={{ background: hue }}><Type /></span>
      <div className="sop-row__main">
        <div className="sop-row__title">
          {a.sop?.title ?? "Untitled SOP"}
          {a.mandatory && a.status !== "COMPLETED" && <span className="sop-row__mand"><BadgeAlert /> Mandatory</span>}
        </div>
        <div className="sop-row__meta">
          {a.sop?.sopType && <span>{TYPE_LABEL[a.sop.sopType]}</span>}
          {a.sop?.category && <span>· {a.sop.category}</span>}
          {a.sop?.version && <span>· v{a.sop.version}</span>}
        </div>
        {a.status !== "COMPLETED" && a.stepsTotal > 0 && (
          <div className="sop-row__bar"><div className="sop-row__bar-fill" style={{ width: `${pct}%` }} /></div>
        )}
      </div>
      <div className="sop-row__right">
        {a.status !== "COMPLETED" && a.stepsTotal > 0 && <span className="sop-row__pct">{pct}%</span>}
        {chip && <span className={`sop-row__chip sop-row__chip--${chip.tone}`}>{chip.label}</span>}
      </div>
    </Link>
  );
}
