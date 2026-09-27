"use client";

/* /automation/health: are your automations working?
 * (spec-ai-automation /automation/health). Every Member reads it.
 *
 *   GET /api/automation/health?days=7|30|90           totals, success rate,
 *                                                    failures by alert level
 *   GET /api/automation/runs?status=FAILED,PARTIAL&days=&take=8
 *
 * The window (?days=, default 30) is URL state, and it travels with every
 * link into Logs so the numbers there match the numbers here.
 */

import { Suspense, useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { ChevronRight } from "lucide-react";
import { OsPageHeader } from "@/components/layout/os/page-header";
import { OsEmptyView } from "@/components/layout/os/empty-view";
import { ViewTab } from "@/components/ui/view-tabs";
import { TableCard, type TableColumn } from "@/components/ui/table-card";
import { RunStatusChip } from "@/components/automation/run-status-chip";
import { CARD, InlineRow, BTN } from "@/components/automation/automation-ui";
import { apiFetch } from "@/lib/api-fetch";
import { RUN_TONE_COLOR } from "@/lib/automation/run-status";
import { ALERT_LABEL, ALERT_LEVELS } from "@/lib/automation/workflow-list";
import { formatCount, formatDate, formatRelative } from "@/lib/format/date";
import { useDatePrefs } from "@/lib/format/use-date-prefs";

interface Health {
  window: { from: string; to: string };
  totals: { total: number; byStatus: Record<string, number> };
  successRate: number | null;
  failuresBySeverity: Record<string, number>;
}

interface FailedRun {
  id: string;
  status: string;
  workflow: { id: string; name: string } | null;
  triggerName: string;
  errorMessage: string | null;
  startedAt: string | null;
  createdAt: string;
}

const WINDOWS = [7, 30, 90] as const;

const LEGEND: Array<{ key: string; label: string; view: string; tone: keyof typeof RUN_TONE_COLOR }> = [
  { key: "SUCCESS", label: "Succeeded", view: "succeeded", tone: "success" },
  { key: "FAILED", label: "Failed", view: "failed", tone: "danger" },
  { key: "PARTIAL", label: "Partly done", view: "partial", tone: "warning" },
  { key: "SKIPPED", label: "Skipped", view: "skipped", tone: "neutral" },
];

function Donut({ rate }: { rate: number | null }) {
  const r = 44;
  const c = 2 * Math.PI * r;
  const pct = rate ?? 0;
  return (
    <div className="relative size-[112px] shrink-0">
      <svg viewBox="0 0 100 100" className="size-full -rotate-90" aria-hidden>
        <circle cx="50" cy="50" r={r} fill="none" stroke="var(--os-surface-2)" strokeWidth="6" />
        {rate !== null ? (
          <circle cx="50" cy="50" r={r} fill="none" stroke="var(--os-brand)" strokeWidth="6" strokeLinecap="round" strokeDasharray={`${(pct / 100) * c} ${c}`} />
        ) : null}
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span className="text-title font-semibold tabular-nums text-ink">{rate === null ? "None" : `${pct}%`}</span>
        <span className="text-sm text-ink-2">{rate === null ? "finished" : "succeeded"}</span>
      </div>
    </div>
  );
}

function HealthInner() {
  const router = useRouter();
  const sp = useSearchParams();
  const datePrefs = useDatePrefs();
  const daysRaw = Number(sp?.get("days"));
  const days = (WINDOWS as readonly number[]).includes(daysRaw) ? daysRaw : 30;

  const [health, setHealth] = useState<Health | null>(null);
  const [failures, setFailures] = useState<FailedRun[] | null>(null);
  const [failTotal, setFailTotal] = useState(0);
  const [error, setError] = useState(false);

  const load = useCallback(async () => {
    const [h, f] = await Promise.all([
      apiFetch<Health>(`/api/automation/health?days=${days}`, { cache: "no-store" }),
      apiFetch<{ runs: FailedRun[]; total: number }>(`/api/automation/runs?status=FAILED,PARTIAL&days=${days}&take=8`, { cache: "no-store" }),
    ]);
    if (!h.ok || !f.ok) {
      setError(true);
      return;
    }
    setError(false);
    setHealth(h.data);
    setFailures(f.data.runs);
    setFailTotal(f.data.total);
  }, [days]);

  useEffect(() => {
    const t = setTimeout(() => void load(), 0);
    const onFocus = () => void load();
    window.addEventListener("focus", onFocus);
    return () => {
      clearTimeout(t);
      window.removeEventListener("focus", onFocus);
    };
  }, [load]);

  const columns = useMemo<TableColumn<FailedRun>[]>(() => [
    { key: "status", label: "Status", width: "140px", render: (r) => <RunStatusChip status={r.status} /> },
    {
      key: "workflow",
      label: "Automation",
      title: true,
      width: "minmax(180px,1.4fr)",
      render: (r) => r.workflow
        ? <Link href={`/automation/workflows/${r.workflow.id}`} onClick={(e) => e.stopPropagation()} className="truncate hover:underline">{r.workflow.name}</Link>
        : <span className="text-ink-3">Removed</span>,
    },
    { key: "when", label: "When", width: "minmax(160px,1fr)", render: (r) => <span className="truncate text-ink-2">{r.triggerName}</span> },
    {
      key: "started",
      label: "Started",
      width: "120px",
      render: (r) => {
        const at = r.startedAt ?? r.createdAt;
        return <span className="text-ink-2" title={formatDate(at, datePrefs, "datetime")}>{formatRelative(at, datePrefs)}</span>;
      },
    },
    { key: "error", label: "Error", width: "minmax(200px,2fr)", render: (r) => <span className="truncate text-ink-2" title={r.errorMessage ?? undefined}>{r.errorMessage ?? "No message"}</span> },
  ], [datePrefs]);

  const total = health?.totals.total ?? 0;
  const noRuns = health !== null && total === 0;

  return (
    <>
      <OsPageHeader
        title="Health"
        views={
          <>
            {WINDOWS.map((d) => (
              <ViewTab key={d} label={`${d} days`} active={days === d} onClick={() => router.replace(d === 30 ? "/automation/health" : `/automation/health?days=${d}`, { scroll: false })} />
            ))}
          </>
        }
      />
      <div className="px-6 pb-10 pt-2">
        <div className="os-chrome flex max-w-[1080px] flex-col gap-8">
          {error ? (
            <InlineRow action={{ label: "Try again", onClick: () => void load() }}>Couldn&apos;t load health</InlineRow>
          ) : health === null ? (
            <div aria-busy="true" aria-label="Loading health" className="flex flex-col gap-4">
              <div className={`${CARD} h-[160px] animate-pulse bg-skeleton/40`} />
              <TableCard ariaLabel="Recent failures" columns={columns} rows={null} rowKey={(r) => r.id} skeletonRows={5} />
            </div>
          ) : noRuns ? (
            <OsEmptyView
              context="board"
              title={`No automations have run in the last ${days} days`}
              action={{ label: "See your workflows", href: "/automation/workflows" }}
            />
          ) : (
            <>
              <section className={`${CARD} p-6`} aria-labelledby="runs-title">
                <h2 id="runs-title" className="m-0 mb-4 text-base font-semibold text-ink">How runs went</h2>
                <div className="flex flex-wrap items-center gap-8">
                  <Donut rate={health.successRate} />
                  <div className="flex min-w-[240px] flex-1 flex-col">
                    {LEGEND.map((l) => (
                      <Link
                        key={l.key}
                        href={`/automation/logs?status=${l.view}&days=${days}`}
                        className="flex h-9 items-center gap-2 rounded-md px-2 text-row text-ink hover:bg-hover"
                      >
                        <span className="size-2 shrink-0 rounded-full" style={{ backgroundColor: RUN_TONE_COLOR[l.tone] }} aria-hidden />
                        <span className="flex-1">{l.label}</span>
                        <span className="tabular-nums text-ink-2">{formatCount(health.totals.byStatus[l.key] ?? 0, datePrefs)}</span>
                        <ChevronRight className="size-4 shrink-0 text-ink-3" aria-hidden />
                      </Link>
                    ))}
                  </div>
                </div>
                <p className="m-0 mt-3 text-sm text-ink-3">
                  {formatCount(total, datePrefs)} run{total === 1 ? "" : "s"} in the last {days} days. Skipped and running ones do not count toward the rate.
                </p>
              </section>

              <section className={`${CARD}`} aria-labelledby="alert-title">
                <h2 id="alert-title" className="m-0 px-5 pb-2 pt-4 text-base font-semibold text-ink">Failures by alert level</h2>
                <div className="flex flex-col pb-2">
                  {ALERT_LEVELS.map((a) => (
                    <Link
                      key={a}
                      href={`/automation/logs?status=failed&severity=${a}&days=${days}`}
                      className="mx-2 flex h-11 items-center gap-2 rounded-md px-3 text-row text-ink hover:bg-hover"
                    >
                      <span className="flex-1">{ALERT_LABEL[a]}</span>
                      <span className="tabular-nums text-ink-2">{formatCount(health.failuresBySeverity[a] ?? 0, datePrefs)}</span>
                      <ChevronRight className="size-4 shrink-0 text-ink-3" aria-hidden />
                    </Link>
                  ))}
                </div>
              </section>

              <section aria-labelledby="fail-title" className="flex flex-col gap-2">
                <div className="flex items-center justify-between">
                  <h2 id="fail-title" className="m-0 text-base font-semibold text-ink">Recent failures</h2>
                  {failTotal > 0 ? (
                    <Link href={`/automation/logs?status=failed,partial&days=${days}`} className={`text-sm ${BTN.link}`}>See all failures</Link>
                  ) : null}
                </div>
                <TableCard
                  ariaLabel="Recent failures"
                  columns={columns}
                  rows={failures}
                  rowKey={(r) => r.id}
                  // A click, not an href: the Automation cell is itself a
                  // link, and an anchor may not hold another anchor.
                  onRowClick={(r) => router.push(`/automation/logs?runId=${r.id}`)}
                  empty={<span className="text-ink-2">Nothing has failed. Good.</span>}
                  footer={failures && failures.length > 0 ? { total: failTotal, noun: "records", from: 1, to: failures.length } : undefined}
                />
              </section>
            </>
          )}
        </div>
      </div>
    </>
  );
}

export default function AutomationHealthPage() {
  return (
    <Suspense fallback={null}>
      <HealthInner />
    </Suspense>
  );
}
