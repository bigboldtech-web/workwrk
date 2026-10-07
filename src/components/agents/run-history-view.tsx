"use client";

// Run history (spec-ai-automation section 2, /agents?tab=runs), moved
// unchanged out of the Agents page when /agents became AI teammates
// (docs/plans/ai-teammates.md 5.1). The filters are URL state
// (&agentSlug= &status= &from= &to=); sort and page size live with the page
// header's toolbar in workspace-agents-view.tsx, which renders this view and
// opens a run in its agent's drawer. A routine's run reads "Routine".

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { TableCard, type TableColumn } from "@/components/ui/table-card";
import { FilterGroup, FilterPanel, FilterRow } from "@/components/ui/filter-panel";
import { RunStatusChip } from "@/components/automation/run-status-chip";
import { apiFetch } from "@/lib/api-fetch";
import { formatDate, formatRelative } from "@/lib/format/date";
import { formatDuration } from "@/lib/format/duration";
import { useDatePrefs } from "@/lib/format/use-date-prefs";
import type { Agent, RemovedAgent } from "./workspace-agents-view";

export type RunRow = {
  id: string;
  agentName: string;
  agentSlug: string;
  trigger: "SCHEDULED" | "MANUAL" | "CHAT" | "ROUTINE" | "DELEGATED" | "TALK" | "AUTOMATION";
  status: string;
  startedAt: string;
  durationMs: number | null;
  summary: string;
  sessionId: string | null;
  error: string | null;
  /** A Member reading a run somebody else started: status and tools only. */
  detailHidden?: boolean;
};

export const TRIGGER_LABEL: Record<RunRow["trigger"], string> = { SCHEDULED: "Scheduled", MANUAL: "Manual", CHAT: "From a chat", ROUTINE: "Routine", DELEGATED: "Asked by a teammate", TALK: "From Talk", AUTOMATION: "From an automation" };
export const RUN_SORTS = ["newest", "oldest"] as const;
export const RUN_SORT_LABEL: Record<(typeof RUN_SORTS)[number], string> = { newest: "Newest first", oldest: "Oldest first" };
export const PAGE_SIZES = [25, 50, 100];
const STATUS_FILTERS = [
  { key: "succeeded", label: "Succeeded" },
  { key: "failed", label: "Failed" },
  { key: "running", label: "Running" },
] as const;

/* ─────────────────────────── Run history ─────────────────────────── */

export function RunHistory({ agents, removed, filterOpen, onCloseFilter, sort, pageSize, onPageSize, version, onOpenRun }: {
  agents: Agent[];
  removed: RemovedAgent[];
  filterOpen: boolean;
  onCloseFilter: () => void;
  sort: (typeof RUN_SORTS)[number];
  pageSize: number;
  onPageSize: (n: number) => void;
  version: number;
  onOpenRun: (r: RunRow) => void;
}) {
  const router = useRouter();
  const sp = useSearchParams();
  const datePrefs = useDatePrefs();

  const agentSlug = sp?.get("agentSlug") ?? null;
  const statuses = useMemo(() => (sp?.get("status") ?? "").split(",").filter(Boolean), [sp]);
  const from = sp?.get("from") ?? null;
  const to = sp?.get("to") ?? null;
  const activeFilters = (agentSlug ? 1 : 0) + (statuses.length ? 1 : 0) + (from || to ? 1 : 0);

  const [filterSearch, setFilterSearch] = useState("");
  const [rows, setRows] = useState<RunRow[] | null>(null);
  const [total, setTotal] = useState(0);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [pages, setPages] = useState<(string | null)[]>([null]);
  const [error, setError] = useState(false);

  const setParams = useCallback((patch: Record<string, string | null>) => {
    const next = new URLSearchParams(sp?.toString() ?? "");
    for (const [k, v] of Object.entries(patch)) {
      if (v === null || v === "") next.delete(k);
      else next.set(k, v);
    }
    router.replace(`/agents?${next.toString()}`, { scroll: false });
  }, [router, sp]);

  const query = useMemo(() => {
    const q = new URLSearchParams({ take: String(pageSize), sort });
    if (agentSlug) q.set("agentSlug", agentSlug);
    if (statuses.length) q.set("status", statuses.join(","));
    if (from) q.set("from", from);
    if (to) q.set("to", to);
    return q.toString();
  }, [pageSize, sort, agentSlug, statuses, from, to]);

  const load = useCallback(async (cursor: string | null) => {
    const r = await apiFetch<{ runs: RunRow[]; total: number; nextCursor: string | null; restarted?: boolean }>(`/api/agents/runs?${query}${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`, { cache: "no-store" });
    if (!r.ok) { setError(true); return; }
    setError(false);
    if (r.data.restarted) setPages([null]);
    setRows(r.data.runs);
    setTotal(r.data.total);
    setNextCursor(r.data.nextCursor);
  }, [query]);

  useEffect(() => {
    const t = setTimeout(() => { setPages([null]); void load(null); }, 0);
    return () => clearTimeout(t);
  }, [load, version]);
  useEffect(() => {
    const onFocus = () => void load(null);
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, [load]);

  const toggleStatus = (key: string, on: boolean) => {
    const next = new Set(statuses);
    if (on) next.add(key); else next.delete(key);
    setParams({ status: [...next].join(",") || null });
  };

  const columns = useMemo<TableColumn<RunRow>[]>(() => [
    { key: "status", label: "Status", width: "140px", render: (r) => <RunStatusChip status={r.status} /> },
    { key: "agent", label: "Agent", title: true, width: "minmax(160px,1fr)", render: (r) => r.agentName },
    { key: "trigger", label: "Trigger", width: "120px", render: (r) => <span className="text-sm text-ink-2">{TRIGGER_LABEL[r.trigger] ?? "From a chat"}</span> },
    { key: "started", label: "Started", width: "130px", render: (r) => <span className="text-sm text-ink-2" title={formatDate(r.startedAt, datePrefs, "datetime")}>{formatRelative(r.startedAt, datePrefs)}</span> },
    { key: "duration", label: "Duration", width: "96px", numeric: true, render: (r) => <span className="text-sm text-ink-2">{formatDuration(r.durationMs) ?? "Running"}</span> },
    { key: "summary", label: "Summary", width: "minmax(220px,2fr)", render: (r) => <span className="truncate text-sm text-ink-2">{r.summary}</span> },
  ], [datePrefs]);

  const pageIndex = pages.length - 1;
  const fieldMatch = (label: string) => label.toLowerCase().includes(filterSearch.toLowerCase());

  return (
    <>
      {/* The padding sits outside .os-chrome so this card lines up with the
          Your agents card (both 24 at the 14px page root); only the row
          inside is on the px grid. */}
      <div className="px-6 pb-10 pt-2">
      <div className="os-chrome flex min-h-0 gap-4">
        <FilterPanel
          open={filterOpen}
          onClose={onCloseFilter}
          objects="runs"
          activeCount={activeFilters}
          onClearAll={() => setParams({ agentSlug: null, status: null, from: null, to: null })}
          search={{ value: filterSearch, onChange: setFilterSearch, placeholder: "Search fields" }}
        >
          {fieldMatch("agent") ? (
            <FilterGroup label="Agent">
              {agents.length + removed.length === 0 ? <span className="px-2 text-sm text-ink-3">No agents yet</span> : (
                <>
                  {agents.map((a) => (
                    <FilterRow key={a.slug} label={a.name} checked={agentSlug === a.slug} onCheckedChange={(on) => setParams({ agentSlug: on ? a.slug : null })} />
                  ))}
                  {/* A removed agent's runs are kept, so it stays filterable. */}
                  {removed.filter((r) => !agents.some((a) => a.slug === r.slug)).map((a) => (
                    <FilterRow key={a.slug} label={`${a.name} (removed)`} checked={agentSlug === a.slug} onCheckedChange={(on) => setParams({ agentSlug: on ? a.slug : null })} />
                  ))}
                </>
              )}
            </FilterGroup>
          ) : null}
          {fieldMatch("status") ? (
            <FilterGroup label="Status">
              {STATUS_FILTERS.map((s) => (
                <FilterRow key={s.key} label={s.label} checked={statuses.includes(s.key)} onCheckedChange={(on) => toggleStatus(s.key, on)} />
              ))}
            </FilterGroup>
          ) : null}
          {fieldMatch("date range started") ? (
            <FilterGroup label="Started">
              <FilterRow label="Date range" checked={Boolean(from || to)} onCheckedChange={(on) => setParams(on ? { from: new Date(Date.now() - 7 * 86_400_000).toISOString().slice(0, 10) } : { from: null, to: null })}>
                <div className="flex flex-col gap-1.5">
                  <label className="flex items-center gap-2 text-sm text-ink-2">From <input type="date" value={from ?? ""} onChange={(e) => setParams({ from: e.target.value || null })} className="h-8 rounded-md border border-line-strong bg-raised px-2 text-sm text-ink" /></label>
                  <label className="flex items-center gap-2 text-sm text-ink-2">To <input type="date" value={to ?? ""} onChange={(e) => setParams({ to: e.target.value || null })} className="h-8 rounded-md border border-line-strong bg-raised px-2 text-sm text-ink" /></label>
                </div>
              </FilterRow>
            </FilterGroup>
          ) : null}
        </FilterPanel>

        <div className="flex min-w-0 flex-1 flex-col">
          {error ? (
            <div className="flex h-11 items-center gap-2 text-row text-ink-2">
              Couldn&apos;t load the run history ·
              <button type="button" className="font-medium text-brand-deep hover:underline" onClick={() => void load(pages[pageIndex] ?? null)}>Try again</button>
            </div>
          ) : (
            <TableCard
              ariaLabel="Agent runs"
              columns={columns}
              rows={rows}
              rowKey={(r) => r.id}
              skeletonRows={5}
              onRowClick={(r) => onOpenRun(r)}
              empty={activeFilters ? (
                <span className="text-row text-ink-2">No runs match · <button type="button" className="text-brand-deep hover:underline" onClick={() => setParams({ agentSlug: null, status: null, from: null, to: null })}>Clear filters</button></span>
              ) : <span className="text-row text-ink-2">No runs yet</span>}
              footer={rows && rows.length > 0 ? {
                total,
                noun: "records",
                from: pageIndex * pageSize + 1,
                to: pageIndex * pageSize + rows.length,
                onPrev: pageIndex > 0 ? () => { const next = pages.slice(0, -1); setPages(next); void load(next[next.length - 1] ?? null); } : undefined,
                onNext: nextCursor ? () => { setPages([...pages, nextCursor]); void load(nextCursor); } : undefined,
                pageSize,
                pageSizes: PAGE_SIZES,
                onPageSize,
              } : undefined}
            />
          )}
        </div>
      </div>
      </div>
    </>
  );
}
