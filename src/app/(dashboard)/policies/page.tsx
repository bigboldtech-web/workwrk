"use client";

/* Policies library — clean card/list grid grouped by category, mirroring the
 * SOP library's design language (toolbar + status-pill filter + grid/list).
 *
 *  GET   /api/policies            list policies (with my-ack state)
 *  POST  /api/policies            { title, content, status? }
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  ShieldCheck, Plus, Search, ChevronRight, ChevronDown, FileText, CheckCircle2,
  Archive, Edit3, AlertTriangle, Activity, Loader2, LayoutGrid, List as ListIcon,
  Calendar as CalendarIcon, Users,
} from "lucide-react";
import { OsTitleBar } from "@/components/layout/os/title-bar";
import { OsEmptyView } from "@/components/layout/os/empty-view";
import { GRAD } from "@/components/layout/os/catalog";
import { useOsShell } from "@/components/layout/os/shell-context";
import { useOsToast } from "@/components/layout/os/toast";

type PolStatus = "DRAFT" | "PUBLISHED" | "ARCHIVED";

type ApiPolicy = {
  id: string;
  title: string;
  category?: string | null;
  version: number;
  status: PolStatus;
  requiresAck: boolean;
  effectiveDate?: string | null;
  createdAt: string;
  updatedAt: string;
  acknowledged?: boolean;
  ackRate?: number;
  totalAcks?: number;
  totalUsers?: number;
};

const STATUS_LABEL: Record<PolStatus, string> = { DRAFT: "Draft", PUBLISHED: "Published", ARCHIVED: "Archived" };
const STATUS_ICON: Record<PolStatus, typeof Edit3> = { DRAFT: Edit3, PUBLISHED: CheckCircle2, ARCHIVED: Archive };
const STATUS_PILL: Record<PolStatus, string> = {
  DRAFT: "bg-zinc-100 text-zinc-600",
  PUBLISHED: "bg-emerald-50 text-emerald-700",
  ARCHIVED: "bg-zinc-100 text-zinc-400",
};
const STATUS_FILTERS: Array<"ALL" | PolStatus> = ["ALL", "PUBLISHED", "DRAFT"];

const fmtDate = (d: string) => new Date(d).toLocaleDateString("en-US", { month: "short", day: "numeric" });
function rateHue(pct: number): string {
  if (pct >= 90) return "var(--os-c-green)";
  if (pct >= 70) return "var(--os-c-teal)";
  if (pct >= 40) return "var(--os-c-orange)";
  return "var(--os-c-red)";
}

export default function PoliciesPage() {
  const router = useRouter();
  const [rows, setRows] = useState<ApiPolicy[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<"ALL" | PolStatus>("ALL");
  const [activeCategory, setActiveCategory] = useState<string | null>(null);
  const [showArchived, setShowArchived] = useState(false);
  const [view, setView] = useState<"grid" | "list">("grid");
  const { rowVersion } = useOsShell();
  const { toast } = useOsToast();

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/policies");
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      setRows(data.data ?? (Array.isArray(data) ? data : []));
      setLoadError(null);
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : "load failed");
    }
  }, []);
  useEffect(() => { void load(); }, [load]);
  const v = rowVersion("policies");
  useEffect(() => { if (v > 0) void load(); }, [v, load]);

  async function quickAdd() {
    try {
      const res = await fetch("/api/policies", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: "Untitled policy", content: "", status: "DRAFT" }),
      });
      if (!res.ok) { toast(res.status === 403 ? "Manager access required" : "Couldn't create"); return; }
      const data = await res.json();
      const created = data.data ?? data;
      if (created?.id) router.push(`/policies/${created.id}?edit=1`);
      else { toast("Policy created"); void load(); }
    } catch { toast("Couldn't create"); }
  }

  const stats = useMemo(() => {
    const list = rows ?? [];
    const counts: Record<PolStatus, number> = { DRAFT: 0, PUBLISHED: 0, ARCHIVED: 0 };
    for (const p of list) counts[p.status] = (counts[p.status] ?? 0) + 1;
    const pendingMyAck = list.filter((p) => p.requiresAck && !p.acknowledged).length;
    return { total: list.length, counts, pendingMyAck };
  }, [rows]);

  const filtered = useMemo(() => {
    let list = rows ?? [];
    if (!showArchived) list = list.filter((p) => p.status !== "ARCHIVED");
    if (statusFilter !== "ALL") list = list.filter((p) => p.status === statusFilter);
    if (activeCategory) list = list.filter((p) => (p.category ?? "Uncategorized") === activeCategory);
    const q = search.trim().toLowerCase();
    if (q) list = list.filter((p) =>
      p.title.toLowerCase().includes(q) || (p.category ?? "").toLowerCase().includes(q));
    return list;
  }, [rows, search, statusFilter, activeCategory, showArchived]);

  const categories = useMemo(() => {
    const m = new Map<string, number>();
    for (const p of rows ?? []) {
      if (!showArchived && p.status === "ARCHIVED") continue;
      const cat = p.category ?? "Uncategorized";
      m.set(cat, (m.get(cat) ?? 0) + 1);
    }
    return Array.from(m.entries()).sort(([, a], [, b]) => b - a);
  }, [rows, showArchived]);

  const grouped = useMemo(() => {
    const m = new Map<string, ApiPolicy[]>();
    for (const p of filtered) {
      const cat = p.category ?? "Uncategorized";
      if (!m.has(cat)) m.set(cat, []);
      m.get(cat)!.push(p);
    }
    return Array.from(m.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([name, items]) => ({ name, items: items.slice().sort((a, b) => a.title.localeCompare(b.title)) }));
  }, [filtered]);

  return (
    <>
      <OsTitleBar
        title="Policies"
        showStandardActions={false}
        Icon={ShieldCheck}
        iconGradient={GRAD.indigoBlue}
        description={rows === null ? "Loading…" : `${stats.total} polic${stats.total === 1 ? "y" : "ies"} · ${stats.counts.PUBLISHED} published${stats.pendingMyAck > 0 ? ` · ${stats.pendingMyAck} need your ack` : ""}`}
        actions={
          <div className="flex items-center gap-2">
            <Link href="/sops" className="inline-flex h-8 items-center gap-1.5 rounded-md border border-zinc-200 px-2.5 text-[13px] text-zinc-700 hover:bg-zinc-50"><FileText className="h-3.5 w-3.5" /> SOPs</Link>
            <Link href="/policies/compliance" className="inline-flex h-8 items-center gap-1.5 rounded-md border border-zinc-200 px-2.5 text-[13px] text-zinc-700 hover:bg-zinc-50"><Activity className="h-3.5 w-3.5" /> Compliance</Link>
            <button type="button" onClick={quickAdd} className="inline-flex h-8 items-center gap-1.5 rounded-md px-3 text-[13px] font-medium text-white hover:opacity-90" style={{ background: "var(--os-brand)" }}>
              <Plus className="h-3.5 w-3.5" /> New policy
            </button>
          </div>
        }
      />

      <div className="px-6 py-5">
        {/* Toolbar */}
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex h-9 min-w-[200px] flex-1 items-center gap-2 rounded-lg border border-zinc-200 bg-white px-3">
            <Search className="h-4 w-4 shrink-0 text-zinc-400" />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search title, category…"
              className="h-full w-full bg-transparent text-[13px] text-zinc-900 outline-none placeholder:text-zinc-400"
            />
          </div>

          {categories.length > 0 && (
            <div className="relative">
              <select
                value={activeCategory ?? ""}
                onChange={(e) => setActiveCategory(e.target.value || null)}
                className="h-9 cursor-pointer appearance-none rounded-lg border border-zinc-200 bg-white pl-3 pr-8 text-[13px] text-zinc-700 outline-none hover:bg-zinc-50"
              >
                <option value="">All categories ({stats.total})</option>
                {categories.map(([cat, n]) => (
                  <option key={cat} value={cat}>{cat} ({n})</option>
                ))}
              </select>
              <ChevronDown className="pointer-events-none absolute right-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-zinc-400" />
            </div>
          )}

          <div className="flex items-center gap-0.5 rounded-lg bg-zinc-100 p-0.5">
            <button type="button" onClick={() => setView("grid")} title="Card view"
              className={`inline-flex h-7 w-7 items-center justify-center rounded-md transition-colors ${view === "grid" ? "bg-white text-zinc-900 shadow-sm" : "text-zinc-500 hover:text-zinc-800"}`}>
              <LayoutGrid className="h-4 w-4" />
            </button>
            <button type="button" onClick={() => setView("list")} title="List view"
              className={`inline-flex h-7 w-7 items-center justify-center rounded-md transition-colors ${view === "list" ? "bg-white text-zinc-900 shadow-sm" : "text-zinc-500 hover:text-zinc-800"}`}>
              <ListIcon className="h-4 w-4" />
            </button>
          </div>

          <button type="button" onClick={() => setShowArchived((x) => !x)}
            title={showArchived ? "Showing archived policies" : "Show archived policies"}
            className={`inline-flex h-9 items-center gap-1.5 rounded-lg border px-3 text-[13px] transition-colors ${showArchived ? "border-emerald-200 bg-emerald-50 text-emerald-700" : "border-zinc-200 bg-white text-zinc-500 hover:bg-zinc-50"}`}>
            <Archive className="h-3.5 w-3.5" /> Archived{showArchived ? " ✓" : ""}
          </button>
        </div>

        {/* Status filter pills (inline styles survive the .workwrk-os button reset) */}
        <div className="mt-3 flex flex-wrap items-center" style={{ gap: "8px" }}>
          {STATUS_FILTERS.map((s) => {
            const active = statusFilter === s;
            const count = s === "ALL" ? stats.total : stats.counts[s as PolStatus];
            return (
              <button key={s} type="button" onClick={() => setStatusFilter(s)}
                style={{
                  display: "inline-flex", alignItems: "center", gap: "6px", padding: "6px 14px",
                  borderRadius: "9999px", fontSize: "13px", fontWeight: active ? 600 : 400,
                  border: active ? "1px solid var(--os-brand)" : "1px solid #e4e4e7",
                  background: active ? "var(--os-brand)" : "#fff",
                  color: active ? "#fff" : "#52525b", cursor: "pointer", transition: "all .12s",
                }}>
                {s === "ALL" ? "All" : STATUS_LABEL[s as PolStatus]}
                <span style={{ color: active ? "rgba(255,255,255,0.75)" : "#a1a1aa", fontVariantNumeric: "tabular-nums" }}>{count}</span>
              </button>
            );
          })}
        </div>

        {/* Body */}
        <div className="mt-5">
          {loadError ? (
            <OsEmptyView Icon={ShieldCheck} iconGradient={GRAD.redPink} title="Couldn't load policies" subtitle={loadError} cta="Retry" onCta={() => void load()} />
          ) : rows === null ? (
            <div className="flex items-center gap-2 py-16 text-sm text-zinc-400"><Loader2 className="h-4 w-4 animate-spin" /> Loading policies…</div>
          ) : stats.total === 0 ? (
            <OsEmptyView
              Icon={ShieldCheck}
              iconGradient={GRAD.indigoBlue}
              title="No policies yet"
              subtitle="Document the rules. Policies require employee acknowledgment by default and version automatically as you edit."
              chips={["HR", "Security", "Compliance", "Code of Conduct"]}
              cta="New policy"
              onCta={quickAdd}
            />
          ) : grouped.length === 0 ? (
            <div className="flex items-center justify-center gap-2 py-16 text-sm text-zinc-400">
              <AlertTriangle className="h-4 w-4" /> No policies match the current filter.
            </div>
          ) : (
            <div className="space-y-7">
              {grouped.map((g) => (
                <section key={g.name}>
                  <header className="mb-2.5 flex items-center gap-2">
                    <h2 className="text-[12px] font-semibold uppercase tracking-wide text-zinc-500">{g.name}</h2>
                    <span className="rounded-full bg-zinc-100 px-1.5 text-[11px] tabular-nums text-zinc-500">{g.items.length}</span>
                    <span className="h-px flex-1 bg-zinc-100" />
                  </header>
                  {view === "list" ? (
                    <div className="divide-y divide-zinc-100 overflow-hidden rounded-xl border border-zinc-200 bg-white">
                      {g.items.map((p) => <PolicyRow key={p.id} p={p} />)}
                    </div>
                  ) : (
                    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
                      {g.items.map((p) => <PolicyCard key={p.id} p={p} />)}
                    </div>
                  )}
                </section>
              ))}
            </div>
          )}
        </div>
      </div>
    </>
  );
}

function PolicyCard({ p }: { p: ApiPolicy }) {
  const Icon = STATUS_ICON[p.status];
  const ackRate = p.ackRate ?? 0;
  return (
    <Link href={`/policies/${p.id}`} className="group flex flex-col rounded-xl border border-zinc-200 bg-white p-4 transition-all hover:border-zinc-300 hover:shadow-[0_2px_12px_-6px_rgba(0,0,0,0.15)]">
      <div className="flex items-center justify-between gap-2">
        <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium ${STATUS_PILL[p.status]}`}>
          <Icon className="h-3 w-3" /> {STATUS_LABEL[p.status]}
        </span>
        <span className="text-[11px] text-zinc-400">v{p.version}</span>
      </div>

      <h3 className="mt-2.5 line-clamp-2 text-[14px] font-semibold text-zinc-900 group-hover:text-zinc-950">{p.title}</h3>

      <div className="mt-2 flex flex-wrap items-center gap-2 text-[11px]">
        {p.requiresAck && (
          p.acknowledged ? (
            <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2 py-0.5 font-medium text-emerald-700"><CheckCircle2 className="h-3 w-3" /> You&apos;ve acked</span>
          ) : (
            <span className="inline-flex items-center gap-1 rounded-full bg-amber-50 px-2 py-0.5 font-medium text-amber-700"><AlertTriangle className="h-3 w-3" /> Ack required</span>
          )
        )}
        {p.effectiveDate && (
          <span className="inline-flex items-center gap-1 text-zinc-400"><CalendarIcon className="h-3 w-3" /> Eff {new Date(p.effectiveDate).toLocaleDateString("en-US", { month: "short", day: "numeric" })}</span>
        )}
      </div>

      <div className="mt-3 flex items-center gap-3 border-t border-zinc-100 pt-2.5 text-[11px] text-zinc-400">
        {p.requiresAck && (
          <span className="inline-flex items-center gap-1" title="Org acknowledgement rate">
            <Users className="h-3 w-3" />
            <span style={{ color: rateHue(ackRate) }}>{ackRate}%</span>
            {p.totalAcks != null && p.totalUsers != null && <span>· {p.totalAcks}/{p.totalUsers}</span>}
          </span>
        )}
        <span className="ml-auto inline-flex items-center gap-1">
          <FileText className="h-3 w-3" /> {fmtDate(p.updatedAt)}
          <ChevronRight className="h-3 w-3 opacity-0 transition-opacity group-hover:opacity-100" />
        </span>
      </div>
    </Link>
  );
}

function PolicyRow({ p }: { p: ApiPolicy }) {
  const Icon = STATUS_ICON[p.status];
  const ackRate = p.ackRate ?? 0;
  return (
    <Link href={`/policies/${p.id}`} className="group flex items-center gap-3 px-4 py-2.5 transition-colors hover:bg-zinc-50">
      <span className={`inline-flex w-[92px] shrink-0 items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium ${STATUS_PILL[p.status]}`}>
        <Icon className="h-3 w-3" /> {STATUS_LABEL[p.status]}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[13.5px] font-medium text-zinc-900">{p.title}</span>
        {p.effectiveDate && <span className="block truncate text-[12px] text-zinc-400">Effective {new Date(p.effectiveDate).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}</span>}
      </span>
      {p.requiresAck && (
        p.acknowledged
          ? <span className="hidden shrink-0 items-center gap-1 text-[11px] text-emerald-600 sm:inline-flex"><CheckCircle2 className="h-3 w-3" /> Acked</span>
          : <span className="hidden shrink-0 items-center gap-1 text-[11px] text-amber-600 sm:inline-flex"><AlertTriangle className="h-3 w-3" /> Ack</span>
      )}
      {p.requiresAck && (
        <span className="hidden shrink-0 items-center gap-1 text-[11px] tabular-nums sm:inline-flex" style={{ color: rateHue(ackRate) }} title="Org ack rate"><Users className="h-3 w-3" /> {ackRate}%</span>
      )}
      <span className="shrink-0 text-[11px] tabular-nums text-zinc-400">v{p.version}</span>
      <span className="shrink-0 text-[11px] tabular-nums text-zinc-400">{fmtDate(p.updatedAt)}</span>
      <ChevronRight className="h-3.5 w-3.5 shrink-0 text-zinc-300 group-hover:text-zinc-500" />
    </Link>
  );
}
