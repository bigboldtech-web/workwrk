"use client";

/* /automation/health — run health over the last 30 days.
 *
 *  GET /api/automation/health                       → totals, success rate,
 *                                                     failures by severity
 *  GET /api/automation/runs?status=FAILED,PARTIAL   → recent failures list
 *
 * Severity cards (Critical/Major/Minor), a hand-rolled SVG success
 * donut (product-mosaic technique), and recent failures linking into
 * Logs. Honest empty states: no runs at all → one quiet panel; runs but
 * no failures → "all clear" note.
 */

import { useEffect, useState } from "react";
import Link from "next/link";
import { Activity, HeartPulse, Loader2 } from "lucide-react";
import {
  AutomationHeader,
  CARD,
  RUN_STATUS_COLORS,
  SEVERITY_META,
  relTime,
} from "../shared";

interface HealthResp {
  totals: { total: number; byStatus: Record<string, number> };
  successRate: number | null;
  failuresBySeverity: Record<string, number>;
}

interface ApiRun {
  id: string;
  workflowId: string;
  workflow: { id: string; name: string } | null;
  status: string;
  errorMessage: string | null;
  createdAt: string;
}

function SuccessDonut({ rate, size = 148 }: { rate: number; size?: number }) {
  const r = (size - 14) / 2;
  const c = 2 * Math.PI * r;
  const len = (Math.max(0, Math.min(100, rate)) / 100) * c;
  return (
    <div className="relative" style={{ width: size, height: size }}>
      {/* Track inherits currentColor from the zinc wrapper so the dark
          catchalls keep it visible on both themes. */}
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="text-zinc-400">
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          stroke="currentColor"
          strokeOpacity={0.18}
          strokeWidth={12}
          fill="none"
        />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          stroke="#00C875"
          strokeWidth={12}
          fill="none"
          strokeDasharray={`${len} ${c - len}`}
          strokeLinecap="round"
          transform={`rotate(-90 ${size / 2} ${size / 2})`}
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span className="text-[24px] font-semibold leading-none tabular-nums text-zinc-900">
          {rate}%
        </span>
        <span className="mt-1 text-[10.5px] uppercase tracking-wide text-zinc-400">success</span>
      </div>
    </div>
  );
}

export default function AutomationHealthPage() {
  const [health, setHealth] = useState<HealthResp | null>(null);
  const [failures, setFailures] = useState<ApiRun[] | null>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    let alive = true;
    Promise.all([
      fetch("/api/automation/health", { cache: "no-store" }).then((r) => (r.ok ? r.json() : null)),
      fetch("/api/automation/runs?status=FAILED,PARTIAL&take=8", { cache: "no-store" }).then((r) =>
        r.ok ? r.json() : null,
      ),
    ])
      .then(([h, runs]) => {
        if (!alive) return;
        if (!h) {
          setError(true);
          return;
        }
        setHealth(h);
        setFailures(Array.isArray(runs?.runs) ? runs.runs : []);
      })
      .catch(() => {
        if (alive) setError(true);
      });
    return () => {
      alive = false;
    };
  }, []);

  const byStatus = health?.totals.byStatus ?? {};
  const statusLegend = [
    { key: "SUCCESS", label: "Success" },
    { key: "FAILED", label: "Failed" },
    { key: "PARTIAL", label: "Partial" },
    { key: "SKIPPED", label: "Skipped" },
  ];

  return (
    <div className="flex h-full flex-col bg-white">
      <AutomationHeader Icon={HeartPulse} title="Health" meta="last 30 days" />

      <div className="flex-1 overflow-y-auto p-4">
        {error ? (
          <div className="p-6 text-[13px] text-zinc-500">Couldn&apos;t load automation health.</div>
        ) : health === null ? (
          <div className="flex items-center gap-2 p-6 text-[13px] text-zinc-500">
            <Loader2 className="h-4 w-4 animate-spin" /> Loading…
          </div>
        ) : (
          <div className="mx-auto max-w-5xl space-y-4">
            {/* Severity cards */}
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
              {SEVERITY_META.map((s) => {
                const count = health.failuresBySeverity[s.key] ?? 0;
                return (
                  <div key={s.key} className={`${CARD} p-4`}>
                    <div className="flex items-center gap-1.5 text-[12px] font-medium text-zinc-500">
                      <span className="h-2 w-2 rounded-full" style={{ backgroundColor: s.color }} aria-hidden />
                      {s.label} failures
                    </div>
                    <div
                      className="mt-2 text-[24px] font-semibold leading-none tabular-nums"
                      style={{ color: count > 0 ? s.color : undefined }}
                    >
                      <span className={count > 0 ? "" : "text-zinc-900"}>{count}</span>
                    </div>
                    <div className="mt-1 text-[11.5px] text-zinc-400">
                      failed runs of {s.label.toLowerCase()}-severity workflows
                    </div>
                  </div>
                );
              })}
            </div>

            {health.totals.total === 0 ? (
              // No runs at all — health metrics have nothing to say yet.
              <div className={`${CARD} flex flex-col items-center px-6 py-14`}>
                <span className="grid h-11 w-11 place-items-center rounded-full bg-zinc-50">
                  <Activity className="h-5 w-5 text-zinc-500" />
                </span>
                <div className="mt-3 text-[14px] font-semibold text-zinc-900">No runs yet</div>
                <p className="mt-1 max-w-sm text-center text-[12.5px] text-zinc-500">
                  Success rate and failure breakdowns appear here after your first automation runs.
                </p>
                <Link
                  href="/automation/workflows"
                  className="mt-4 text-[12.5px] font-medium text-[#0073EA] hover:underline"
                >
                  Go to workflows →
                </Link>
              </div>
            ) : (
              <div className="grid grid-cols-1 gap-3 lg:grid-cols-[300px_1fr]">
                {/* Success donut */}
                <div className={`${CARD} flex flex-col items-center p-4`}>
                  <div className="self-start text-[12.5px] font-semibold text-zinc-900">
                    Success rate
                  </div>
                  <div className="mt-3">
                    <SuccessDonut rate={health.successRate ?? 0} />
                  </div>
                  <div className="mt-4 flex flex-wrap items-center justify-center gap-x-3 gap-y-1 text-[11px] text-zinc-500">
                    {statusLegend.map((s) => (
                      <span key={s.key} className="inline-flex items-center gap-1.5 tabular-nums">
                        <span
                          className="h-2 w-2 rounded-full"
                          style={{ backgroundColor: RUN_STATUS_COLORS[s.key] }}
                          aria-hidden
                        />
                        {s.label} · {byStatus[s.key] ?? 0}
                      </span>
                    ))}
                  </div>
                </div>

                {/* Recent failures */}
                <div className={`${CARD} p-4`}>
                  <div className="flex items-baseline justify-between">
                    <div className="text-[12.5px] font-semibold text-zinc-900">Recent failures</div>
                    <Link
                      href="/automation/logs"
                      className="text-[11.5px] font-medium text-zinc-500 hover:text-zinc-900"
                    >
                      View all logs →
                    </Link>
                  </div>
                  {failures === null || failures.length === 0 ? (
                    <div className="py-8 text-center text-[12.5px] text-zinc-400">
                      No failed runs in this window. All clear.
                    </div>
                  ) : (
                    <div className="mt-2">
                      {failures.map((run) => (
                        <Link
                          key={run.id}
                          href={`/automation/logs?workflowId=${run.workflowId}`}
                          className="flex h-9 items-center gap-2.5 border-b border-zinc-100 px-1 last:border-0 hover:bg-zinc-50"
                        >
                          <span
                            className="h-2 w-2 shrink-0 rounded-full"
                            style={{ backgroundColor: RUN_STATUS_COLORS[run.status] ?? "#A1A1AA" }}
                            aria-hidden
                          />
                          <span className="w-44 shrink-0 truncate text-[12.5px] font-medium text-zinc-900">
                            {run.workflow?.name ?? "Deleted workflow"}
                          </span>
                          <span className="min-w-0 flex-1 truncate text-[12px] text-zinc-500">
                            {run.errorMessage ?? (run.status === "PARTIAL" ? "Some actions failed" : "Run failed")}
                          </span>
                          <span className="shrink-0 text-[11.5px] tabular-nums text-zinc-400">
                            {relTime(run.createdAt)}
                          </span>
                        </Link>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
