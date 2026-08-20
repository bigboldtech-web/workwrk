"use client";

/* /automation/usage — this month's action metering.
 *
 *  GET /api/automation/usage    → used/limit/blocked, zero-filled daily
 *                                 series, top workflows/actions/users
 *  GET /api/automation/actions  → action key → display name
 *
 * ClickUp "Usage" tab parity: actions-used progress card with the plan
 * limit spelled out, a recharts daily bar chart (currentColor ticks off
 * a zinc wrapper, no animation — same recipe as chart-widget.tsx), and
 * top workflows / actions / users mini-tables. No upgrade button —
 * billing isn't wired, so none is shown.
 */

import { useEffect, useState } from "react";
import { GaugeCircle, Loader2 } from "lucide-react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { AutomationHeader, BRAND_BLUE, CARD } from "../shared";

interface UsageResp {
  month: { from: string; used: number; limit: number; remaining: number; blocked: boolean };
  daily: Array<{ date: string; count: number }>;
  topWorkflows: Array<{ workflowId: string | null; name: string; count: number }>;
  topActions: Array<{ actionKey: string; count: number }>;
  topUsers: Array<{ userId: string | null; name: string; count: number }>;
}

const TOOLTIP_STYLE = {
  fontSize: 12,
  borderRadius: 8,
  border: "1px solid #e4e4e7",
} as const;

function MiniTable({
  title,
  rows,
}: {
  title: string;
  rows: Array<{ key: string; label: string; count: number }>;
}) {
  return (
    <div className={`${CARD} p-4`}>
      <div className="text-[13.5px] font-semibold text-zinc-900">{title}</div>
      {rows.length === 0 ? (
        <div className="py-5 text-[13px] text-zinc-400">Nothing yet this month.</div>
      ) : (
        <div className="mt-1.5">
          {rows.map((r) => (
            <div
              key={r.key}
              className="flex h-7 items-center gap-2 border-b border-zinc-100 text-[13.5px] last:border-0"
            >
              <span className="min-w-0 flex-1 truncate text-zinc-700">{r.label}</span>
              <span className="shrink-0 tabular-nums text-zinc-500">{r.count}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export default function AutomationUsagePage() {
  const [usage, setUsage] = useState<UsageResp | null>(null);
  const [actionNames, setActionNames] = useState<Map<string, string>>(new Map());
  const [error, setError] = useState(false);

  useEffect(() => {
    let alive = true;
    fetch("/api/automation/usage", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (!alive) return;
        if (!data) {
          setError(true);
          return;
        }
        setUsage(data);
      })
      .catch(() => {
        if (alive) setError(true);
      });
    fetch("/api/automation/actions")
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (!alive || !Array.isArray(data?.actions)) return;
        setActionNames(
          new Map(
            (data.actions as Array<{ key: string; name: string }>).map((a) => [a.key, a.name]),
          ),
        );
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, []);

  const monthLabel = usage
    ? new Date(usage.month.from).toLocaleDateString("en-US", { month: "long", year: "numeric" })
    : null;
  const pct =
    usage && usage.month.limit > 0
      ? Math.min(100, Math.round((usage.month.used / usage.month.limit) * 100))
      : 0;

  return (
    <div className="flex h-full flex-col bg-white">
      <AutomationHeader Icon={GaugeCircle} title="Usage" meta={monthLabel ?? undefined} />

      <div className="flex-1 overflow-y-auto p-4">
        {error ? (
          <div className="p-6 text-[14px] text-zinc-500">Couldn&apos;t load automation usage.</div>
        ) : usage === null ? (
          <div className="flex items-center gap-2 p-6 text-[14px] text-zinc-500">
            <Loader2 className="h-4 w-4 animate-spin" /> Loading…
          </div>
        ) : (
          <div className="mx-auto max-w-5xl space-y-4">
            {/* Actions used vs limit */}
            <div className={`${CARD} p-4`}>
              <div className="flex items-baseline justify-between">
                <div className="text-[13.5px] font-semibold text-zinc-900">Actions used</div>
                <div className="text-[13px] tabular-nums text-zinc-500">
                  {usage.month.used.toLocaleString()} / {usage.month.limit.toLocaleString()} · {pct}%
                </div>
              </div>
              <div className="mt-2.5 h-2 overflow-hidden rounded-full bg-zinc-100">
                <div
                  className="h-full rounded-full transition-[width]"
                  style={{
                    width: `${pct}%`,
                    backgroundColor: usage.month.blocked ? "#E2445C" : BRAND_BLUE,
                  }}
                />
              </div>
              <p className="mt-2 text-[13px] text-zinc-500">
                {usage.month.blocked ? (
                  <span className="font-medium text-[#E2445C]">
                    Limit reached — automations are paused until the counter resets on the 1st.
                  </span>
                ) : (
                  <>
                    Your workspace can execute {usage.month.limit.toLocaleString()} automation
                    actions per month; {usage.month.remaining.toLocaleString()} remain. The counter
                    resets on the 1st.
                  </>
                )}
              </p>
            </div>

            {/* Daily usage */}
            <div className={`${CARD} p-4`}>
              <div className="text-[13.5px] font-semibold text-zinc-900">Daily usage</div>
              {usage.month.used === 0 ? (
                <div className="flex h-[180px] items-center justify-center text-[13.5px] text-zinc-400">
                  No actions executed this month yet.
                </div>
              ) : (
                // currentColor ticks/grid inherit the wrapper's zinc, which
                // the dark catchalls repaint (chart-widget.tsx recipe).
                <div className="mt-2 h-[220px] text-zinc-400">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={usage.daily} margin={{ top: 8, right: 8, bottom: 0, left: -22 }}>
                      <CartesianGrid stroke="currentColor" strokeOpacity={0.12} vertical={false} />
                      <XAxis
                        dataKey="date"
                        tickFormatter={(d: string) => String(Number(d.slice(8)))}
                        tick={{ fontSize: 10, fill: "currentColor" }}
                        tickLine={false}
                        axisLine={false}
                      />
                      <YAxis
                        allowDecimals={false}
                        tick={{ fontSize: 10, fill: "currentColor" }}
                        tickLine={false}
                        axisLine={false}
                      />
                      <Tooltip
                        contentStyle={TOOLTIP_STYLE}
                        cursor={{ fill: "currentColor", fillOpacity: 0.06 }}
                        labelFormatter={(d) =>
                          new Date(String(d)).toLocaleDateString("en-US", {
                            month: "short",
                            day: "numeric",
                          })
                        }
                      />
                      <Bar
                        dataKey="count"
                        name="Actions"
                        fill={BRAND_BLUE}
                        radius={[3, 3, 0, 0]}
                        isAnimationActive={false}
                      />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              )}
            </div>

            {/* Top consumers */}
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
              <MiniTable
                title="Top workflows"
                rows={usage.topWorkflows.map((w) => ({
                  key: w.workflowId ?? w.name,
                  label: w.name,
                  count: w.count,
                }))}
              />
              <MiniTable
                title="Top actions"
                rows={usage.topActions.map((a) => ({
                  key: a.actionKey,
                  label: actionNames.get(a.actionKey) ?? a.actionKey,
                  count: a.count,
                }))}
              />
              <MiniTable
                title="Top users"
                rows={usage.topUsers.map((u) => ({
                  key: u.userId ?? u.name,
                  label: u.name,
                  count: u.count,
                }))}
              />
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
