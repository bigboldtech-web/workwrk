"use client";

/* Real Talent page (9-box assessments).
 *
 *  GET  /api/talent-assessment       list assessments visible to me
 *  POST /api/talent-assessment       { userId, period, performance, potential, action?, notes? }
 *
 *  Each assessment places a person on a 3×3 grid: performance (1-3) × potential (1-3).
 *  We group by box position (high performers, future leaders, etc.).
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { Users2, ClipboardList, ChartPie, BarChart, Calendar as CalendarIcon } from "lucide-react";
import { OsTitleBar } from "@/components/layout/os/title-bar";
import { OsTabs, type TabDef } from "@/components/layout/os/tabs";
import { OsFilterBar } from "@/components/layout/os/filter-bar";
import { OsMainTable, type Column, type TableGroup, type Row } from "@/components/layout/os/main-table";
import { OsCalendar, type CalendarEvent } from "@/components/layout/os/calendar";
import { OsEmptyView } from "@/components/layout/os/empty-view";
import { C, GRAD, PEOPLE } from "@/components/layout/os/catalog";
import { useOsShell } from "@/components/layout/os/shell-context";
import { useOsToast } from "@/components/layout/os/toast";

type ApiAssessment = {
  id: string;
  userId: string;
  period: string;
  performance: 1 | 2 | 3;
  potential: 1 | 2 | 3;
  boxPosition: string;
  action?: string | null;
  notes?: string | null;
  createdAt: string;
  updatedAt: string;
  user?: { id: string; firstName?: string | null; lastName?: string | null; avatar?: string | null; department?: { name?: string | null } | null; role?: { title?: string | null } | null } | null;
};

const BOX_LABELS: Record<string, string> = {
  "3-3": "Stars (high perf · high potential)",
  "3-2": "High performers · solid potential",
  "3-1": "Workhorses (high perf · limited potential)",
  "2-3": "Future leaders (medium perf · high potential)",
  "2-2": "Core players",
  "2-1": "Steady contributors",
  "1-3": "Diamonds in rough (low perf · high potential)",
  "1-2": "Inconsistent",
  "1-1": "At risk / re-evaluate",
};
const BOX_COLORS: Record<string, string> = {
  "3-3": C.green, "3-2": C.teal,  "3-1": C.blue,
  "2-3": C.indigo, "2-2": C.purple, "2-1": C.pink,
  "1-3": C.orange, "1-2": C.brown, "1-1": C.red,
};
const BOX_ORDER = ["3-3", "3-2", "2-3", "3-1", "2-2", "1-3", "2-1", "1-2", "1-1"];

const AV_PALETTE = [C.purple, C.green, C.orange, C.pink, C.teal, C.indigo, C.blue, C.red];
function avColor(s: string) { let h = 0; for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0; return AV_PALETTE[h % AV_PALETTE.length]; }
function initials(f?: string | null, l?: string | null) {
  const fa = (f ?? "")[0] ?? "";
  const la = (l ?? "")[0] ?? "";
  return ((fa + la) || "?").toUpperCase();
}

const PERF_LABEL: Record<number, string> = { 1: "Low", 2: "Medium", 3: "High" };

function asseToRow(a: ApiAssessment): Row {
  const name = a.user ? `${a.user.firstName ?? ""} ${a.user.lastName ?? ""}`.trim() || "Unknown" : "Unknown";
  return {
    id: a.id,
    name,
    cells: {
      employee: a.user ? [{ initials: initials(a.user.firstName, a.user.lastName), color: avColor(a.userId) }] : [],
      department: a.user?.department?.name ?? "—",
      role: a.user?.role?.title ?? "—",
      perf: PERF_LABEL[a.performance] ?? "—",
      potential: PERF_LABEL[a.potential] ?? "—",
      period: a.period,
      action: a.action ?? "—",
      assessed: { iso: a.updatedAt },
    },
  };
}

function buildGroups(rows: ApiAssessment[]): TableGroup[] {
  const buckets = new Map<string, ApiAssessment[]>();
  for (const k of BOX_ORDER) buckets.set(k, []);
  for (const a of rows) {
    if (!buckets.has(a.boxPosition)) buckets.set(a.boxPosition, []);
    buckets.get(a.boxPosition)!.push(a);
  }
  return BOX_ORDER
    .map((k) => ({
      id: k, title: BOX_LABELS[k] ?? k,
      color: BOX_COLORS[k] ?? C.gray,
      rows: (buckets.get(k) ?? []).map(asseToRow),
    }))
    .filter((g) => g.rows.length > 0);
}

const COLUMNS: Column[] = [
  { id: "employee",   label: "Employee",   type: "person" },
  { id: "department", label: "Department", type: "text" },
  { id: "role",       label: "Role",       type: "text" },
  { id: "perf",       label: "Performance", type: "text" },
  { id: "potential",  label: "Potential",   type: "text" },
  { id: "period",     label: "Period",     type: "text" },
  { id: "action",     label: "Action",     type: "text" },
  { id: "assessed",   label: "Assessed",   type: "date" },
];

const TABS: TabDef[] = [
  { id: "table",     label: "Main table", Icon: ClipboardList },
  { id: "calendar",  label: "Calendar",   Icon: CalendarIcon },
  { id: "gantt",     label: "Gantt",      Icon: BarChart },
  { id: "dashboard", label: "Dashboard",  Icon: ChartPie },
];

export default function TalentPage() {
  const [rows, setRows] = useState<ApiAssessment[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState("table");
  const { rowVersion } = useOsShell();
  const { toast } = useOsToast();

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/talent-assessment");
      if (res.status === 403) {
        setLoadError("Talent grid requires manager-level access.");
        return;
      }
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      setRows(data.data ?? (Array.isArray(data) ? data : []));
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : "load failed");
    }
  }, []);
  useEffect(() => { void load(); }, [load]);
  const v = rowVersion("talent");
  useEffect(() => { if (v > 0) void load(); }, [v, load]);

  const groups = useMemo(() => buildGroups(rows ?? []), [rows]);

  const handlers = {
    onAdd: async (_g: string) => {
      toast("Adding a talent placement needs a user + performance/potential — use the 9-box drawer");
      throw new Error("not supported");
    },
  };

  const calendarEvents = useMemo<CalendarEvent[]>(
    () => (rows ?? []).map((a): CalendarEvent => ({
      id: a.id,
      title: `${a.user?.firstName ?? "?"} → ${a.boxPosition} (${a.period})`,
      date: a.updatedAt,
      color: BOX_COLORS[a.boxPosition] ?? C.gray,
      payload: asseToRow(a).cells,
    })),
    [rows],
  );

  const stars = (rows ?? []).filter((r) => r.boxPosition === "3-3").length;
  const atRisk = (rows ?? []).filter((r) => r.boxPosition === "1-1").length;

  return (
    <>
      <OsTitleBar
        title="Talent"
        Icon={Users2}
        iconGradient={GRAD.bluePurple}
        description={rows === null ? "Loading 9-box…" : `${rows.length} placement${rows.length === 1 ? "" : "s"} · ${stars} star${stars === 1 ? "" : "s"}${atRisk > 0 ? ` · ${atRisk} at-risk` : ""}`}
        people={[PEOPLE.bb, PEOPLE.mk]}
        morePeople={4}
      />
      <OsTabs tabs={TABS} active={activeTab} onSelect={setActiveTab} />

      {activeTab === "table" && (
        <>
          <OsFilterBar newLabel="Place person" activeFilters={0} />
          {loadError ? (
            <OsEmptyView Icon={Users2} iconGradient={GRAD.redPink} title="Couldn't load talent grid" subtitle={loadError} cta="Back" />
          ) : rows === null ? (
            <div style={{ padding: "60px 24px", textAlign: "center", color: "var(--os-ink-3)", fontSize: 13 }}>Loading…</div>
          ) : rows.length === 0 ? (
            <OsEmptyView Icon={Users2} iconGradient={GRAD.bluePurple} title="No 9-box placements yet" subtitle="Plot your team on the performance × potential grid. Auto-place from performance scores or assess manually." chips={["Stars", "Future leaders", "Core players", "At-risk"]} cta="Auto-place" />
          ) : (
            <OsMainTable moduleId="talent" columns={COLUMNS} groups={groups} handlers={handlers} />
          )}
        </>
      )}

      {activeTab === "calendar" && (
        <OsCalendar moduleId="talent" events={calendarEvents} newLabel="Place person" />
      )}

      {activeTab !== "table" && activeTab !== "calendar" && (
        <OsEmptyView Icon={Users2} iconGradient={GRAD.bluePurple} title={`${TABS.find((t) => t.id === activeTab)?.label ?? "View"} coming soon`} subtitle="Shares live data with Main table." chips={["Live data"]} cta="Back to Main table" />
      )}
    </>
  );
}
