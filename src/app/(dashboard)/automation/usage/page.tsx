"use client";

/* /automation/usage: how much of a month's automation allowance the
 * workspace used (spec-ai-automation /automation/usage).
 *
 *   GET /api/automation/usage?month=YYYY-MM   { month, used, limit, blocked,
 *       paused, isCurrent, daily, topAutomations, topActions, topPeople? }
 *
 * The month is URL state (?month=, default this month). Top people is
 * per-person activity: the server sends it to Owners and Admins only, so a
 * Member sees two cards, not a gap and not a locked card.
 */

import { Suspense, useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { OsPageHeader } from "@/components/layout/os/page-header";
import { TableCard, type TableColumn } from "@/components/ui/table-card";
import { PersonAvatar } from "@/components/board-view/assignee-picker";
import { CARD, InlineRow } from "@/components/automation/automation-ui";
import { apiFetch } from "@/lib/api-fetch";
import { formatCount } from "@/lib/format/date";
import { monthKey, shiftMonth } from "@/lib/automation/settings";

interface Usage {
  month: string;
  isCurrent: boolean;
  used: number;
  limit: number;
  blocked: boolean;
  paused: boolean;
  daily: Array<{ date: string; count: number }>;
  topAutomations: Array<{ id: string | null; name: string; count: number }>;
  topActions: Array<{ key: string; label: string; count: number }>;
  topPeople?: Array<{ userId: string | null; name: string; avatarUrl: string | null; count: number }>;
}

const fmt = (n: number) => formatCount(n);

function monthLabel(key: string): string {
  const [y, m] = key.split("-").map(Number);
  return new Date(y, (m || 1) - 1, 1).toLocaleDateString(undefined, { month: "long", year: "numeric" });
}

/** The month's daily counts: one neutral series, bars anchored to the baseline. */
function DailyBars({ daily, month }: { daily: Usage["daily"]; month: string }) {
  const max = Math.max(1, ...daily.map((d) => d.count));
  return (
    <>
      <div className="flex h-[140px] items-end gap-[2px]" aria-hidden>
        {daily.map((d) => {
          const h = d.count === 0 ? 0 : Math.max(3, Math.round((d.count / max) * 132));
          return (
            <div key={d.date} className="group relative flex h-full min-w-0 flex-1 items-end" title={`${d.date}: ${fmt(d.count)} action${d.count === 1 ? "" : "s"}`}>
              <div className="w-full rounded-t-sm bg-[var(--os-ink-3)] group-hover:bg-[var(--os-ink-2)]" style={{ height: h }} />
            </div>
          );
        })}
      </div>
      <div className="mt-1 flex justify-between text-xs text-ink-3" aria-hidden>
        <span>{daily[0]?.date.slice(8) ?? ""}</span>
        <span>{daily[daily.length - 1]?.date.slice(8) ?? ""}</span>
      </div>
      <table className="sr-only">
        <caption>Actions each day in {monthLabel(month)}</caption>
        <thead><tr><th>Day</th><th>Actions</th></tr></thead>
        <tbody>{daily.map((d) => <tr key={d.date}><td>{d.date}</td><td>{d.count}</td></tr>)}</tbody>
      </table>
    </>
  );
}

function UsageInner() {
  const router = useRouter();
  const sp = useSearchParams();
  const current = monthKey(new Date());
  const raw = sp?.get("month") ?? "";
  const month = /^\d{4}-\d{2}$/.test(raw) ? raw : current;

  const [usage, setUsage] = useState<Usage | null>(null);
  const [error, setError] = useState(false);

  const load = useCallback(async () => {
    const r = await apiFetch<Usage>(`/api/automation/usage?month=${month}`, { cache: "no-store" });
    if (!r.ok) {
      setError(true);
      return;
    }
    setError(false);
    setUsage(r.data);
  }, [month]);
  useEffect(() => {
    const t = setTimeout(() => { setUsage(null); void load(); }, 0);
    return () => clearTimeout(t);
  }, [load]);

  const go = (key: string) => router.replace(key === current ? "/automation/usage" : `/automation/usage?month=${key}`, { scroll: false });

  const autoCols = useMemo<TableColumn<Usage["topAutomations"][number]>[]>(() => [
    { key: "name", label: "Top 5", title: true, width: "minmax(160px,1fr)", render: (r) => r.id ? <Link href={`/automation/workflows/${r.id}`} className="truncate hover:underline">{r.name}</Link> : <span className="truncate">{r.name}</span> },
    { key: "count", label: "Actions", width: "90px", numeric: true, render: (r) => fmt(r.count) },
  ], []);
  const actionCols = useMemo<TableColumn<Usage["topActions"][number]>[]>(() => [
    { key: "label", label: "Top 5", title: true, width: "minmax(160px,1fr)", render: (r) => <span className="truncate">{r.label}</span> },
    { key: "count", label: "Times", width: "90px", numeric: true, render: (r) => fmt(r.count) },
  ], []);
  const peopleCols = useMemo<TableColumn<NonNullable<Usage["topPeople"]>[number]>[]>(() => [
    {
      key: "name",
      label: "Top 5",
      title: true,
      width: "minmax(160px,1fr)",
      render: (r) => (
        <span className="flex min-w-0 items-center gap-2">
          {r.userId ? <PersonAvatar person={{ id: r.userId, firstName: r.name, lastName: null, avatar: r.avatarUrl }} size={24} /> : null}
          <span className="truncate">{r.name}</span>
        </span>
      ),
    },
    { key: "count", label: "Actions", width: "90px", numeric: true, render: (r) => fmt(r.count) },
  ], []);

  const pct = usage ? Math.min(100, Math.round((usage.used / Math.max(1, usage.limit)) * 100)) : 0;
  const atLimit = usage ? usage.used >= usage.limit : false;
  const tables = usage ? [
    { title: "Top automations", node: <TableCard ariaLabel="Top automations" columns={autoCols} rows={usage.topAutomations} rowKey={(r) => r.id ?? r.name} empty="No automations ran this month." /> },
    { title: "Top actions", node: <TableCard ariaLabel="Top actions" columns={actionCols} rows={usage.topActions} rowKey={(r) => r.key} empty="No actions ran this month." /> },
    ...(usage.topPeople ? [{ title: "Top people", node: <TableCard ariaLabel="Top people" columns={peopleCols} rows={usage.topPeople} rowKey={(r) => r.userId ?? r.name} empty="Nobody set one off this month." /> }] : []),
  ] : [];

  return (
    <>
      <OsPageHeader
        title="Usage"
        views={
          <div className="flex items-center gap-1">
            <button type="button" aria-label="Previous month" disabled={month <= "2000-01"} onClick={() => go(shiftMonth(month, -1))} className="inline-flex size-8 items-center justify-center rounded-md text-ink-2 hover:bg-hover hover:text-ink disabled:opacity-40 disabled:hover:bg-transparent">
              <ChevronLeft className="size-4" aria-hidden />
            </button>
            <span aria-live="polite" className="os-chrome inline-flex h-7 items-center rounded-md bg-active px-2.5 text-base font-medium text-ink">{monthLabel(month)}</span>
            <button
              type="button"
              aria-label="Next month"
              disabled={month >= current}
              onClick={() => go(shiftMonth(month, 1))}
              className="inline-flex size-8 items-center justify-center rounded-md text-ink-2 hover:bg-hover hover:text-ink disabled:opacity-40 disabled:hover:bg-transparent"
            >
              <ChevronRight className="size-4" aria-hidden />
            </button>
          </div>
        }
      />
      <div className="px-6 pb-10 pt-2">
        <div className="os-chrome flex max-w-[1080px] flex-col gap-6">
          {error ? (
            <InlineRow action={{ label: "Try again", onClick: () => void load() }}>Couldn&apos;t load usage</InlineRow>
          ) : usage === null ? (
            <div aria-busy="true" aria-label="Loading usage" className="flex flex-col gap-4">
              <div className={`${CARD} h-[120px] animate-pulse bg-skeleton/40`} />
              <div className={`${CARD} h-[200px] animate-pulse bg-skeleton/40`} />
            </div>
          ) : (
            <>
              <section className={`${CARD} p-5`} aria-labelledby="used-title">
                <h2 id="used-title" className="m-0 text-base font-semibold text-ink">{usage.isCurrent ? "Actions this month" : `Actions in ${monthLabel(usage.month)}`}</h2>
                <div className="mt-4 h-1 w-full overflow-hidden rounded-full bg-[var(--os-surface-2)]" role="progressbar" aria-valuemin={0} aria-valuemax={usage.limit} aria-valuenow={usage.used} aria-label="Actions used">
                  <div className={`h-full rounded-full ${atLimit ? "bg-danger-solid" : "bg-brand"}`} style={{ width: `${pct}%` }} />
                </div>
                <p className="m-0 mt-3 text-row text-ink">
                  <span className="tabular-nums">{fmt(usage.used)}</span> of <span className="tabular-nums">{fmt(usage.limit)}</span> actions used
                  {atLimit && usage.isCurrent ? <span className="text-danger-text">. The allowance is used up.</span> : null}
                </p>
                {usage.blocked ? (
                  <p className="m-0 mt-1 text-base text-danger-text">Automations are paused until the counter resets on the 1st.</p>
                ) : null}
                {usage.paused ? (
                  <p className="m-0 mt-1 text-base text-warning-text">Automations are paused for this workspace, so nothing is running or counting.</p>
                ) : null}
                <p className="m-0 mt-2 text-sm text-ink-2">Every workspace includes {fmt(usage.limit)} actions a month. Each action an automation takes counts once.</p>
              </section>

              <section className={`${CARD} p-5`} aria-labelledby="daily-title">
                <h2 id="daily-title" className="m-0 mb-4 text-base font-semibold text-ink">Each day</h2>
                {usage.daily.every((d) => d.count === 0) ? (
                  <p className="m-0 text-row text-ink-2">No actions have run {usage.isCurrent ? "this month" : `in ${monthLabel(usage.month)}`} yet.</p>
                ) : (
                  <DailyBars daily={usage.daily} month={usage.month} />
                )}
              </section>

              <div className={`grid grid-cols-1 gap-4 ${tables.length === 3 ? "min-[1280px]:grid-cols-3" : "min-[1280px]:grid-cols-2"}`}>
                {tables.map((t) => (
                  <section key={t.title} className="flex min-w-0 flex-col gap-2">
                    <h2 className="m-0 text-base font-semibold text-ink">{t.title}</h2>
                    {t.node}
                  </section>
                ))}
              </div>
            </>
          )}
        </div>
      </div>
    </>
  );
}

export default function AutomationUsagePage() {
  return (
    <Suspense fallback={null}>
      <UsageInner />
    </Suspense>
  );
}
