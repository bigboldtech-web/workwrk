"use client";

// The /analytics body: five numbers, one chart, two tables.
//
// Spec: docs/plans/ui-refresh/spec-work-home.md section 2 (/analytics), W6.
//
// WHAT CHANGED:
//   - Every number comes from the server, over Items and the people the viewer
//     is allowed to see. The old page fired five capped list fetches and
//     counted them in the browser, and `GET /api/tasks` both ignores `?limit`
//     and is scoped to the CALLER, so the "total" tile printed the viewer's own
//     assigned count under an org-wide label.
//   - The ten launcher tiles are gone. Five pointed at route directories that
//     do not exist (/procurement/pos, /financials, /financials/reports,
//     /financials/statements, /planning/variance) and five duplicated doors
//     that already have their own rail hub and sidebar row (Tasks -> /my-work,
//     Timesheets, Headcount -> /people, SOPs, Compliance).
//   - The hard-coded strings that were dressed as data ("Books", "P&L - BS -
//     CF", "Plan vs actual", "Live") are gone with them.
//   - The `ana__*` BEM family is gone; this page is tokens only.
//   - The scope pills are role-derived, so a manager sees one pill rather than
//     two with one that 403s.
//
// The chart is one series, so it carries no legend: the card title names it.
// Past weeks are ink-2 and the current week is brand, a pair validated for
// contrast and colour-vision separation against both themes; the number is
// also on every bar's label and in the hover tooltip, so identity is never
// carried by colour alone.

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { OsPageHeader } from "@/components/layout/os/page-header";
import { OsEmptyView } from "@/components/layout/os/empty-view";
import { ViewTab } from "@/components/ui/view-tabs";
import { FilterPanel, FilterRow } from "@/components/ui/filter-panel";
import { StatTile, StatTileSkeleton } from "@/components/ui/stat-tile";
import { EntityTile } from "@/components/ui/entity-tile";
import { DotsArt } from "@/components/ui/dots-art";
import { Avatar } from "@/components/ui/avatar-stack";
import { apiFetch, type ApiResult } from "@/lib/api-fetch";
import { useShortcut } from "@/lib/shortcuts";
import {
  ANALYTICS_PERIODS,
  ANALYTICS_SCOPES,
  ANALYTICS_TILES,
  type AnalyticsResult,
  type AnalyticsScope,
  deltaOf,
  formatTileValue,
  personName,
  weekLabel,
} from "@/lib/analytics-view";

interface Department {
  id: string;
  name: string;
}

export function AnalyticsClient({
  scopes,
  initialScope,
  initialPeriod,
  canPickDepartment,
  canExport,
}: {
  scopes: AnalyticsScope[];
  initialScope: AnalyticsScope;
  initialPeriod: string | null;
  canPickDepartment: boolean;
  canExport: boolean;
}) {
  const [scope, setScope] = useState<AnalyticsScope>(initialScope);
  const [period, setPeriod] = useState<string>(
    ANALYTICS_PERIODS.some((p) => p.key === initialPeriod) ? (initialPeriod as string) : "30",
  );
  const [departmentId, setDepartmentId] = useState<string | null>(null);
  const [personId, setPersonId] = useState<string | null>(null);
  const [departments, setDepartments] = useState<Department[]>([]);
  const [data, setData] = useState<AnalyticsResult | null>(null);
  const [failed, setFailed] = useState<string | null>(null);
  const [filterOpen, setFilterOpen] = useState(false);

  const queryString = useMemo(() => {
    const qs = new URLSearchParams({ view: scope, period });
    if (departmentId) qs.set("departmentId", departmentId);
    if (personId) qs.set("personId", personId);
    return qs.toString();
  }, [scope, period, departmentId, personId]);

  const apply = useCallback((res: ApiResult<AnalyticsResult>) => {
    if (!res.ok) { setFailed(res.error); return; }
    setData(res.data);
    setFailed(null);
  }, []);

  const fetchAnalytics = useCallback(
    () => apiFetch<AnalyticsResult>(`/api/analytics?${queryString}`, { cache: "no-store" }),
    [queryString],
  );

  const load = useCallback(async () => { apply(await fetchAnalytics()); }, [fetchAnalytics, apply]);

  // The result is applied through a liveness guard rather than by calling
  // `load` straight out of the effect body: switching scope twice quickly
  // raced two requests, and the slower one won.
  useEffect(() => {
    let live = true;
    void fetchAnalytics().then((res) => { if (live) apply(res); });
    return () => { live = false; };
  }, [fetchAnalytics, apply]);

  // Departments only narrow the org-wide view, so they are only fetched for a
  // viewer who has that pill: no request that could 403 is ever made.
  useEffect(() => {
    if (!canPickDepartment) return;
    let live = true;
    void apiFetch<Department[]>("/api/departments").then((res) => {
      if (live && res.ok && Array.isArray(res.data)) {
        setDepartments(res.data.map((d) => ({ id: d.id, name: d.name })));
      }
    });
    return () => { live = false; };
  }, [canPickDepartment]);

  // No realtime: the spec says re-fetch on focus, and that is all this does.
  useEffect(() => {
    const tick = () => { if (document.visibilityState === "visible") void load(); };
    window.addEventListener("focus", tick);
    return () => { window.removeEventListener("focus", tick); };
  }, [load]);

  useShortcut({ id: "analytics-filter", keys: "f", label: "Filter", scope: "page", run: () => setFilterOpen((v) => !v) });
  useShortcut({
    id: "analytics-view-1",
    keys: "1",
    label: ANALYTICS_SCOPES[0].label,
    scope: "page",
    run: () => { if (scopes.includes("team")) setScope("team"); },
  });
  useShortcut({
    id: "analytics-view-2",
    keys: "2",
    label: ANALYTICS_SCOPES[1].label,
    scope: "page",
    run: () => { if (scopes.includes("org")) setScope("org"); },
  });

  const activeFilters = (period === "30" ? 0 : 1) + (departmentId ? 1 : 0) + (personId ? 1 : 0);
  const loading = data === null && failed === null;
  // "Nobody produced anything" is not the same as "you manage nobody", and the
  // empty state says which.
  const isEmpty =
    data !== null &&
    data.totals.openTasks === 0 &&
    data.totals.completed === 0 &&
    data.totals.overdue === 0 &&
    data.totals.hoursLogged === 0 &&
    data.totals.sopAcks === 0;

  return (
    <>
      <OsPageHeader
        title="Analytics"
        // One pill is not a choice: a surface with a single view renders no
        // views row at all (design-system 4.4).
        views={
          scopes.length > 1 ? (
            <>
              {ANALYTICS_SCOPES.filter((s) => scopes.includes(s.key)).map((s) => (
                <ViewTab
                  key={s.key}
                  label={s.label}
                  active={scope === s.key}
                  onClick={() => { setScope(s.key); setDepartmentId(null); setPersonId(null); }}
                />
              ))}
            </>
          ) : undefined
        }
        toolbar={{
          filter: { open: filterOpen, onToggle: () => setFilterOpen((v) => !v), count: activeFilters },
          // No primary: there is nothing to create on this page.
          menu: canExport ? [{ label: "Export CSV", href: `/api/analytics/export.csv?${queryString}` }] : undefined,
        }}
      />

      <div className="flex min-h-0 flex-1">
        {filterOpen ? (
          <FilterPanel
            open
            onClose={() => setFilterOpen(false)}
            objects="people"
            activeCount={activeFilters}
            onClearAll={() => { setPeriod("30"); setDepartmentId(null); setPersonId(null); }}
          >
            <li className="px-2 pb-1 pt-2 text-micro uppercase text-ink-2">Period</li>
            {ANALYTICS_PERIODS.map((p) => (
              <FilterRow
                key={p.key}
                label={p.label}
                checked={period === p.key}
                // A period is always set, so unchecking the active one returns
                // to the default rather than leaving no window at all.
                onCheckedChange={(on) => setPeriod(on ? p.key : "30")}
              />
            ))}

            {scope === "org" && departments.length > 0 ? (
              <>
                <li className="px-2 pb-1 pt-3 text-micro uppercase text-ink-2">Department</li>
                {departments.map((d) => (
                  <FilterRow
                    key={d.id}
                    label={d.name}
                    checked={departmentId === d.id}
                    onCheckedChange={(on) => setDepartmentId(on ? d.id : null)}
                  />
                ))}
              </>
            ) : null}

            {/* The person list is the people already in the answer, which is
                exactly the chain the viewer may narrow to: no second fetch and
                no way to name somebody outside the set. */}
            {data && data.people.length > 1 ? (
              <>
                <li className="px-2 pb-1 pt-3 text-micro uppercase text-ink-2">Person</li>
                {data.people.map((p) => (
                  <FilterRow
                    key={p.id}
                    label={personName(p)}
                    checked={personId === p.id}
                    onCheckedChange={(on) => setPersonId(on ? p.id : null)}
                  />
                ))}
              </>
            ) : null}
          </FilterPanel>
        ) : null}

        <div className="min-w-0 flex-1 overflow-y-auto px-6 py-4">
          {failed ? (
            <OsEmptyView
              variant="error"
              title="Couldn't load analytics"
              hint={failed}
              action={{ label: "Retry", onClick: () => void load() }}
            />
          ) : loading ? (
            <AnalyticsSkeleton />
          ) : data && data.peopleCount === 0 ? (
            <div className="flex flex-col items-center justify-center gap-2 px-6 py-16 text-center">
              <DotsArt arrangement="grid" size={64} />
              <p className="max-w-[46ch] text-base text-ink-2">
                Nobody reports to you yet, so there is no team to measure.
              </p>
            </div>
          ) : (
            <div className="flex flex-col gap-4">
              <StatRow data={data!} />

              {isEmpty ? (
                <div className="flex flex-col items-center justify-center gap-2 rounded-lg border border-line bg-raised px-6 py-16 text-center">
                  <DotsArt arrangement="grid" size={64} />
                  <p className="max-w-[46ch] text-base text-ink-2">No activity in this period.</p>
                  <p className="text-sm text-ink-3">Try a longer period from the Filter panel.</p>
                </div>
              ) : (
                <>
                  <WeeklyChart weekly={data!.weekly} />
                  <PeopleTable data={data!} />
                  <ListsTable data={data!} />
                </>
              )}
            </div>
          )}
        </div>
      </div>
    </>
  );
}

/* ── The five tiles ─────────────────────────────────────────────── */

function StatRow({ data }: { data: AnalyticsResult }) {
  return (
    <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-5">
      {ANALYTICS_TILES.map((tile) => {
        const value = data.totals[tile.key];
        const delta = tile.comparable ? deltaOf(value, data.previous[tile.key]) : null;
        return (
          <StatTile
            key={tile.key}
            label={tile.label}
            value={formatTileValue(tile, value)}
            delta={delta}
            // Overdue is the only one of the five where a rise is bad, so it is
            // the only one whose delta is allowed a colour.
            deltaMeaning={tile.deltaMeaning}
            hint={tile.comparable ? undefined : `across ${data.peopleCount} ${data.peopleCount === 1 ? "person" : "people"}`}
          />
        );
      })}
    </div>
  );
}

/* ── Completed per week ─────────────────────────────────────────── */

function WeeklyChart({ weekly }: { weekly: AnalyticsResult["weekly"] }) {
  const max = Math.max(1, ...weekly.map((w) => w.completed));
  const total = weekly.reduce((sum, w) => sum + w.completed, 0);
  const lastIndex = weekly.length - 1;

  return (
    <section className="rounded-lg border border-line bg-raised p-4" aria-labelledby="weekly-heading">
      <div className="flex items-baseline justify-between gap-3">
        {/* One series, so the title names it and no legend box is drawn. */}
        <h2 id="weekly-heading" className="text-base font-medium text-ink">Completed per week</h2>
        <span className="text-sm tabular-nums text-ink-2">{total} in this period</span>
      </div>

      {weekly.length === 0 ? (
        <p className="py-10 text-center text-base text-ink-2">No completed work in this period.</p>
      ) : (
        <>
          <div
            className="mt-3 flex h-[200px] items-end gap-[3px] border-b border-line"
            role="img"
            aria-label={`Completed tasks per week: ${weekly.map((w) => `${weekLabel(w.weekStart)} ${w.completed}`).join(", ")}`}
          >
            {weekly.map((w, i) => {
              const current = i === lastIndex;
              const pct = (w.completed / max) * 100;
              return (
                <div key={w.weekStart} className="group relative flex h-full min-w-0 flex-1 flex-col justify-end">
                  {/* The hover tooltip: an HTML chart is interactive, so every
                      mark answers when you point at it, including a zero one. */}
                  <span className="pointer-events-none absolute bottom-full left-1/2 z-10 mb-1 hidden -translate-x-1/2 whitespace-nowrap rounded-md bg-inverse px-2 py-1 text-xs text-inverse-fg group-hover:block">
                    {weekLabel(w.weekStart)}: {w.completed}
                  </span>
                  {/* The hover band, so a wide slot is still a target for the
                      tooltip. It appears on hover only: a permanent full-height
                      track would imply a weekly ceiling, and a count of
                      completed tasks has none. */}
                  <span className="absolute inset-0 rounded-t bg-transparent group-hover:bg-subtle" aria-hidden />
                  <span
                    // Rounded data-end, square at the baseline, capped at 24px
                    // so the band keeps its air instead of being filled.
                    className={`relative mx-auto w-full max-w-[24px] rounded-t ${
                      w.completed > 0 ? (current ? "bg-brand" : "bg-ink-2") : "bg-line-strong"
                    }`}
                    // A zero week keeps a 2px stub on the baseline: the week
                    // happened and nothing was finished in it, which is not the
                    // same as no week at all.
                    style={w.completed > 0 ? { height: `${Math.max(3, pct)}%` } : { height: 2 }}
                  />
                </div>
              );
            })}
          </div>

          <div className="mt-1.5 flex gap-[3px]">
            {weekly.map((w, i) => {
              // Roughly six ticks whatever the period: a 13-week quarter drawn
              // with thirteen labels collapses into unreadable overlap.
              const every = Math.max(1, Math.ceil(weekly.length / 6));
              const show = i === lastIndex || i % every === 0;
              return (
                <span
                  key={w.weekStart}
                  className={`min-w-0 flex-1 truncate text-center text-xs ${i === lastIndex ? "font-medium text-ink" : "text-ink-3"}`}
                >
                  {show ? weekLabel(w.weekStart) : ""}
                </span>
              );
            })}
          </div>
          <p className="mt-2 text-xs text-ink-3">The last bar is the current week, and it is still filling.</p>
        </>
      )}
    </section>
  );
}

/* ── By person ──────────────────────────────────────────────────── */

type PersonSort = "done" | "open" | "overdue" | "hours" | "sopAcks";

function PeopleTable({ data }: { data: AnalyticsResult }) {
  const [sort, setSort] = useState<PersonSort>("done");
  const rows = useMemo(() => [...data.people].sort((a, b) => b[sort] - a[sort]), [data.people, sort]);
  const totals = useMemo(
    () => rows.reduce(
      (acc, p) => ({
        open: acc.open + p.open,
        done: acc.done + p.done,
        overdue: acc.overdue + p.overdue,
        hours: acc.hours + p.hours,
        sopAcks: acc.sopAcks + p.sopAcks,
      }),
      { open: 0, done: 0, overdue: 0, hours: 0, sopAcks: 0 },
    ),
    [rows],
  );

  if (rows.length === 0) return null;

  const cols: Array<{ key: PersonSort; label: string }> = [
    { key: "open", label: "Open" },
    { key: "done", label: "Done" },
    { key: "overdue", label: "Overdue" },
    { key: "hours", label: "Hours" },
    { key: "sopAcks", label: "SOP acks" },
  ];

  return (
    <section className="os-row overflow-x-auto rounded-lg border border-line bg-raised">
      <table className="w-full min-w-[620px] border-collapse">
        <caption className="sr-only">Work by person</caption>
        <thead>
          <tr className="border-b border-line bg-subtle">
            <th scope="col" className="px-4 py-2 text-left text-xs font-medium uppercase tracking-wide text-ink-2">Person</th>
            {/* aria-sort belongs on the header cell, not on the button inside
                it: the cell is what carries the column's sort state. */}
            {cols.map((c) => (
              <th
                key={c.key}
                scope="col"
                aria-sort={sort === c.key ? "descending" : "none"}
                className="px-3 py-2 text-right"
              >
                <button
                  type="button"
                  onClick={() => setSort(c.key)}
                  className={`text-xs font-medium uppercase tracking-wide hover:text-ink ${sort === c.key ? "text-ink" : "text-ink-2"}`}
                >
                  {c.label}
                </button>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((p) => (
            <tr key={p.id} className="border-b border-line-soft last:border-b-0 hover:bg-hover">
              <td className="px-4" style={{ height: 44 }}>
                <Link href={`/people/${p.id}`} className="flex items-center gap-2.5 text-ink hover:underline">
                  <Avatar person={p} size={24} />
                  <span className="truncate">{personName(p)}</span>
                </Link>
              </td>
              <td className="px-3 text-right tabular-nums text-ink">{p.open}</td>
              <td className="px-3 text-right tabular-nums text-ink">{p.done}</td>
              <td className={`px-3 text-right tabular-nums ${p.overdue > 0 ? "text-danger-text" : "text-ink"}`}>{p.overdue}</td>
              <td className="px-3 text-right tabular-nums text-ink">{p.hours.toFixed(1)}</td>
              <td className="px-3 text-right tabular-nums text-ink">{p.sopAcks}</td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr className="border-t border-line bg-subtle">
            <td className="px-4 py-2 text-sm font-medium text-ink-2">{rows.length} {rows.length === 1 ? "person" : "people"}</td>
            <td className="px-3 py-2 text-right text-sm font-medium tabular-nums text-ink">{totals.open}</td>
            <td className="px-3 py-2 text-right text-sm font-medium tabular-nums text-ink">{totals.done}</td>
            <td className="px-3 py-2 text-right text-sm font-medium tabular-nums text-ink">{totals.overdue}</td>
            <td className="px-3 py-2 text-right text-sm font-medium tabular-nums text-ink">{totals.hours.toFixed(1)}</td>
            <td className="px-3 py-2 text-right text-sm font-medium tabular-nums text-ink">{totals.sopAcks}</td>
          </tr>
        </tfoot>
      </table>
    </section>
  );
}

/* ── By list ────────────────────────────────────────────────────── */

function ListsTable({ data }: { data: AnalyticsResult }) {
  if (data.lists.length === 0) return null;
  return (
    <section className="os-row overflow-x-auto rounded-lg border border-line bg-raised">
      <table className="w-full min-w-[520px] border-collapse">
        <caption className="sr-only">Work by list</caption>
        <thead>
          <tr className="border-b border-line bg-subtle">
            <th scope="col" className="px-4 py-2 text-left text-xs font-medium uppercase tracking-wide text-ink-2">List</th>
            <th scope="col" className="px-3 py-2 text-right text-xs font-medium uppercase tracking-wide text-ink-2">Open</th>
            <th scope="col" className="px-3 py-2 text-right text-xs font-medium uppercase tracking-wide text-ink-2">Done</th>
            <th scope="col" className="px-3 py-2 text-right text-xs font-medium uppercase tracking-wide text-ink-2">Overdue</th>
          </tr>
        </thead>
        <tbody>
          {data.lists.map((l) => (
            <tr key={l.id} className="border-b border-line-soft last:border-b-0 hover:bg-hover">
              <td className="px-4" style={{ height: 44 }}>
                <Link href={`/boards/${l.slug}`} className="flex items-center gap-2.5 text-ink hover:underline">
                  <EntityTile size="xs" name={l.name} fallback="list" />
                  <span className="truncate">
                    {l.spaceName ? <span className="text-ink-2">{l.spaceName} › </span> : null}
                    {l.name}
                  </span>
                </Link>
              </td>
              <td className="px-3 text-right tabular-nums text-ink">{l.open}</td>
              <td className="px-3 text-right tabular-nums text-ink">{l.done}</td>
              <td className={`px-3 text-right tabular-nums ${l.overdue > 0 ? "text-danger-text" : "text-ink"}`}>{l.overdue}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}

/* ── Loading ────────────────────────────────────────────────────── */

function AnalyticsSkeleton() {
  return (
    <div className="flex flex-col gap-4" aria-busy="true" aria-label="Loading">
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-5">
        {Array.from({ length: 5 }).map((_, i) => <StatTileSkeleton key={i} />)}
      </div>
      <div className="rounded-lg border border-line bg-raised p-4">
        <span className="os-skeleton-pulse block h-4 w-40 rounded bg-skeleton" />
        <div className="mt-3 flex h-[200px] items-end gap-[2px]">
          {[38, 56, 44, 72, 50, 66, 34, 60].map((h, i) => (
            <span key={i} className="os-skeleton-pulse min-w-0 flex-1 rounded-t bg-skeleton" style={{ height: `${h}%` }} />
          ))}
        </div>
      </div>
      <div className="overflow-hidden rounded-lg border border-line bg-raised">
        <div className="h-9 border-b border-line bg-subtle" />
        {Array.from({ length: 5 }).map((_, i) => (
          <div key={i} className="flex items-center gap-3 border-b border-line-soft px-4 last:border-b-0" style={{ height: 44 }}>
            <span className="os-skeleton-pulse h-6 w-6 shrink-0 rounded-full bg-skeleton" />
            <span className="os-skeleton-pulse h-3.5 rounded bg-skeleton" style={{ width: `${[40, 32, 48, 36, 44][i]}%` }} />
          </div>
        ))}
      </div>
    </div>
  );
}
