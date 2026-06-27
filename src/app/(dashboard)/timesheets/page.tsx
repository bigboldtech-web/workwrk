"use client";

/* Timesheets — week log with approval flow.
 *
 *  GET  /api/timesheets?scope=mine|team|approve|all
 *  POST /api/timesheets               idempotent upsert for current week
 *  PATCH /api/timesheets/[id]         { action: submit | retract | decide }
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Clock, Plus, Calendar as CalendarIcon, CheckCircle2, XCircle,
  Send, RotateCcw, ChevronRight, Loader2, Play,
} from "lucide-react";
import { OsTitleBar } from "@/components/layout/os/title-bar";
import { OsEmptyView } from "@/components/layout/os/empty-view";
import { C, GRAD } from "@/components/layout/os/catalog";
import { useOsShell } from "@/components/layout/os/shell-context";
import { useOsToast } from "@/components/layout/os/toast";

type TsStatus = "DRAFT" | "SUBMITTED" | "APPROVED" | "REJECTED";
type Scope = "mine" | "approve" | "team" | "all";

type ApiTimesheet = {
  id: string;
  status: TsStatus;
  weekStartDate: string;
  totalMinutes?: number | null;
  submittedAt?: string | null;
  decisionAt?: string | null;
  user?: { id: string; firstName?: string | null; lastName?: string | null } | null;
  approver?: { id: string; firstName?: string | null; lastName?: string | null } | null;
  _count?: { entries?: number };
};

type DetailEntry = {
  id: string; day: string; hours: number | null; description?: string | null; source: string;
  item?: { id: string; title: string; board?: { slug: string } | null } | null;
  task?: { id: string; title: string } | null;
};
type SheetDetail = { id: string; entries: DetailEntry[] };

const STATUS_LABELS: Record<TsStatus, string> = { DRAFT: "Draft", SUBMITTED: "Submitted", APPROVED: "Approved", REJECTED: "Rejected" };
const STATUS_COLORS: Record<TsStatus, string> = { DRAFT: C.indigo, SUBMITTED: C.yellow, APPROVED: C.green, REJECTED: C.red };

const AV_PALETTE = [C.purple, C.green, C.orange, C.pink, C.teal, C.indigo, C.blue, C.red];
function avColor(s: string) { let h = 0; for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0; return AV_PALETTE[h % AV_PALETTE.length]; }
function initials(f?: string | null, l?: string | null) { const a = (f ?? "")[0] ?? ""; const b = (l ?? "")[0] ?? ""; return ((a + b) || "?").toUpperCase(); }

function weekLabel(iso: string): string {
  const d = new Date(iso);
  const end = new Date(d.getTime() + 6 * 86_400_000);
  return `${d.toLocaleDateString("en-US", { month: "short", day: "numeric" })} → ${end.toLocaleDateString("en-US", { month: "short", day: "numeric" })}`;
}

export default function TimesheetsPage() {
  const [sheets, setSheets] = useState<ApiTimesheet[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [scope, setScope] = useState<Scope>("mine");
  const { rowVersion } = useOsShell();
  const { toast } = useOsToast();
  const [openId, setOpenId] = useState<string | null>(null);
  const [details, setDetails] = useState<Record<string, SheetDetail | "loading">>({});

  async function toggleDetail(id: string) {
    if (openId === id) { setOpenId(null); return; }
    setOpenId(id);
    if (!details[id]) {
      setDetails((d) => ({ ...d, [id]: "loading" }));
      try {
        const res = await fetch(`/api/timesheets/${id}`);
        const data = await res.json();
        setDetails((d) => ({ ...d, [id]: (data.data ?? data) as SheetDetail }));
      } catch {
        setDetails((d) => { const c = { ...d }; delete c[id]; return c; });
        setOpenId(null);
      }
    }
  }

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/timesheets?scope=${scope}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      setSheets(data.data ?? (Array.isArray(data) ? data : []));
      setLoadError(null);
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : "load failed");
    }
  }, [scope]);
  useEffect(() => { void load(); }, [load]);
  const v = rowVersion("timesheets");
  useEffect(() => { if (v > 0) void load(); }, [v, load]);

  async function act(id: string, action: string, decision?: "APPROVE" | "REJECT") {
    try {
      const res = await fetch(`/api/timesheets/${id}`, {
        method: "PATCH", headers: { "Content-Type": "application/json" },
        body: JSON.stringify(decision ? { action, decision } : { action }),
      });
      if (!res.ok) {
        if (res.status === 403) toast("Permission denied");
        else toast("Couldn't update");
        return;
      }
      toast(action === "submit" ? "Submitted" : action === "retract" ? "Retracted to draft" : decision === "APPROVE" ? "Approved" : "Rejected");
      void load();
    } catch { toast("Couldn't update"); }
  }

  async function startCurrentWeek() {
    try {
      const res = await fetch("/api/timesheets", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({}) });
      if (!res.ok) { toast("Couldn't start"); return; }
      toast("This week's timesheet is open");
      void load();
    } catch { toast("Couldn't start"); }
  }

  const filtered = useMemo(() => (sheets ?? []).slice().sort((a, b) => new Date(b.weekStartDate).getTime() - new Date(a.weekStartDate).getTime()), [sheets]);

  const stats = useMemo(() => {
    const list = sheets ?? [];
    const draft = list.filter((s) => s.status === "DRAFT").length;
    const submitted = list.filter((s) => s.status === "SUBMITTED").length;
    const approved = list.filter((s) => s.status === "APPROVED").length;
    const totalHours = Math.round(list.reduce((acc, s) => acc + (s.totalMinutes ?? 0), 0) / 60);
    return { draft, submitted, approved, totalHours };
  }, [sheets]);

  return (
    <>
      <OsTitleBar
        title="Timesheets"
        Icon={Clock}
        iconGradient={GRAD.indigoBlue}
        description={sheets === null ? "Loading…" : `${filtered.length} timesheet${filtered.length === 1 ? "" : "s"} · ${stats.submitted} submitted · ${stats.totalHours}h logged`}
        actions={
          <div className="tsh__head-actions">
            <button type="button" className="tsh__btn-primary" onClick={startCurrentWeek}>
              <Plus /> Start this week
            </button>
          </div>
        }
      />

      <div className="tsh">
        <div className="tsh__kpis">
          <KpiTile accent="var(--os-c-indigo)" Icon={Play}         label="Drafts"    value={`${stats.draft}`}     sub="in progress" />
          <KpiTile accent="var(--os-c-yellow)" Icon={Loader2}      label="Submitted" value={`${stats.submitted}`} sub="awaiting approval" />
          <KpiTile accent="var(--os-c-green)"  Icon={CheckCircle2} label="Approved"  value={`${stats.approved}`}  sub="finalised" />
          <KpiTile accent="var(--os-c-blue)"   Icon={Clock}        label="Hours logged" value={`${stats.totalHours}`} sub="across all sheets" />
        </div>

        <div className="tsh__scope">
          {(["mine", "approve", "team", "all"] as Scope[]).map((s) => (
            <button key={s} type="button" className={scope === s ? "is-active" : ""} onClick={() => setScope(s)}>
              {s === "mine" ? "Mine" : s === "approve" ? "Approve queue" : s === "team" ? "Team" : "All"}
            </button>
          ))}
        </div>

        {loadError ? (
          <OsEmptyView Icon={Clock} iconGradient={GRAD.redPink} title="Couldn't load timesheets" subtitle={loadError} cta="Retry" />
        ) : sheets === null ? (
          <div className="tsh__loading">Loading…</div>
        ) : filtered.length === 0 ? (
          <OsEmptyView Icon={Clock} iconGradient={GRAD.indigoBlue} title="No timesheets in this view" subtitle="Start a new week's timesheet to begin logging time entries." cta="Start this week" />
        ) : (
          <div className="tsh__list">
            {filtered.map((t) => {
              const statusColor = STATUS_COLORS[t.status];
              const totalH = Math.round(((t.totalMinutes ?? 0) / 60) * 10) / 10;
              const av = t.user ? { initials: initials(t.user.firstName, t.user.lastName), color: avColor(t.user.id) } : null;
              const canSubmit = t.status === "DRAFT";
              const canRetract = t.status === "SUBMITTED";
              const canDecide = t.status === "SUBMITTED" && scope === "approve";
              return (
                <div key={t.id}>
                <article className="tsh__row" style={{ ["--row-c" as unknown as string]: statusColor }}>
                  <span className="tsh__row-accent" aria-hidden="true" />
                  {av && <span className="tsh__row-av" style={{ background: av.color }}>{av.initials}</span>}
                  <div className="tsh__row-main" onClick={() => toggleDetail(t.id)} style={{ cursor: "pointer" }}>
                    <div className="tsh__row-head">
                      <span className={`tsh__row-status tsh__row-status--${t.status.toLowerCase()}`}>{STATUS_LABELS[t.status]}</span>
                      <span className="tsh__row-week"><CalendarIcon /> {weekLabel(t.weekStartDate)}</span>
                    </div>
                    {t.user && <div className="tsh__row-name">{[t.user.firstName, t.user.lastName].filter(Boolean).join(" ")}</div>}
                    <div className="tsh__row-meta">
                      <span><Clock /> {totalH}h logged</span>
                      <span>{t._count?.entries ?? 0} entries</span>
                      {t.approver && <span>· Approved by {[t.approver.firstName, t.approver.lastName].filter(Boolean).join(" ")}</span>}
                    </div>
                  </div>
                  <div className="tsh__row-actions">
                    {canSubmit && <button type="button" className="tsh__act tsh__act--submit" onClick={() => act(t.id, "submit")}><Send /> Submit</button>}
                    {canRetract && <button type="button" className="tsh__act" onClick={() => act(t.id, "retract")}><RotateCcw /> Retract</button>}
                    {canDecide && (
                      <>
                        <button type="button" className="tsh__act tsh__act--approve" onClick={() => act(t.id, "decide", "APPROVE")}><CheckCircle2 /> Approve</button>
                        <button type="button" className="tsh__act tsh__act--reject" onClick={() => act(t.id, "decide", "REJECT")}><XCircle /> Reject</button>
                      </>
                    )}
                  </div>
                  <ChevronRight className="tsh__row-arrow" style={{ transform: openId === t.id ? "rotate(90deg)" : undefined }} />
                </article>
                {openId === t.id ? <SheetDetailPanel detail={details[t.id]} /> : null}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </>
  );
}

function SheetDetailPanel({ detail }: { detail: SheetDetail | "loading" | undefined }) {
  if (!detail || detail === "loading") {
    return <div className="px-4 py-3 text-[12.5px] text-zinc-400">Loading entries…</div>;
  }
  if (!detail.entries || detail.entries.length === 0) {
    return <div className="px-4 py-3 text-[12.5px] text-zinc-400">No entries yet. Track time on a card and it lands here.</div>;
  }
  const byDay = new Map<string, DetailEntry[]>();
  for (const e of detail.entries) {
    const k = e.day.slice(0, 10);
    (byDay.get(k) ?? byDay.set(k, []).get(k)!).push(e);
  }
  const days = [...byDay.keys()].sort();
  return (
    <div className="mx-3 mb-2 rounded-lg border border-zinc-200 bg-zinc-50/60 overflow-hidden">
      {days.map((d) => {
        const entries = byDay.get(d)!;
        const dayTotal = entries.reduce((s, e) => s + (e.hours ?? 0), 0);
        return (
          <div key={d} className="border-b border-zinc-100 last:border-b-0">
            <div className="flex items-center justify-between px-3 py-1.5 bg-white">
              <span className="text-[11.5px] font-semibold text-zinc-600">
                {new Date(d).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" })}
              </span>
              <span className="text-[11.5px] font-semibold text-zinc-500 tabular-nums">{dayTotal.toFixed(2)}h</span>
            </div>
            <ul>
              {entries.map((e) => {
                const title = e.item?.title ?? e.task?.title ?? e.description ?? "Time entry";
                return (
                  <li key={e.id} className="flex items-center gap-2 px-3 py-1.5 text-[12.5px]">
                    <span className="h-1.5 w-1.5 rounded-full bg-[#0073EA] shrink-0" />
                    <span className="text-zinc-700 truncate flex-1">{title}</span>
                    {e.source === "TIMER" ? <span className="text-[10px] text-zinc-400 shrink-0">from timer</span> : null}
                    <span className="font-semibold text-zinc-600 tabular-nums shrink-0">{(e.hours ?? 0).toFixed(2)}h</span>
                  </li>
                );
              })}
            </ul>
          </div>
        );
      })}
    </div>
  );
}

function KpiTile({ accent, Icon, label, value, sub }: { accent: string; Icon: typeof Clock; label: string; value: string; sub: string }) {
  return (
    <div className="tsh__kpi" style={{ ["--kpi-accent" as unknown as string]: accent }}>
      <span className="tsh__kpi-accent" aria-hidden="true" />
      <div className="tsh__kpi-row">
        <div className="tsh__kpi-icon"><Icon /></div>
        <div className="tsh__kpi-label">{label}</div>
      </div>
      <div className="tsh__kpi-value">{value}</div>
      <div className="tsh__kpi-sub">{sub}</div>
    </div>
  );
}
