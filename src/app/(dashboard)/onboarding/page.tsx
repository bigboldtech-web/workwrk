"use client";

/* Real (read-mostly) Onboarding page.
 *
 *  GET  /api/onboarding             list instances (and ?type=templates)
 *  POST /api/onboarding             create instance ({ templateId, userId, buddyId? })
 *                                   or template  ({ type: "template", name, steps, ... })
 *
 *  No PATCH endpoint for instances exists. The `progress` field is a
 *  JSON array of step states. Status enum: NOT_STARTED | IN_PROGRESS |
 *  COMPLETED | OVERDUE. We render read-only with progress + buddy info.
 *  Adding requires picking a template + user — surface friendly toast.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { IdCard, ClipboardList, ChartPie, BarChart, Calendar as CalendarIcon } from "lucide-react";
import { OsTitleBar } from "@/components/layout/os/title-bar";
import { OsTabs, type TabDef } from "@/components/layout/os/tabs";
import { OsFilterBar } from "@/components/layout/os/filter-bar";
import { OsMainTable, type Column, type TableGroup, type Row, type StatusValue } from "@/components/layout/os/main-table";
import { OsCalendar, type CalendarEvent } from "@/components/layout/os/calendar";
import { OsEmptyView } from "@/components/layout/os/empty-view";
import { C, GRAD, PEOPLE } from "@/components/layout/os/catalog";
import { useOsShell } from "@/components/layout/os/shell-context";
import { useOsToast } from "@/components/layout/os/toast";

type ObStatus = "NOT_STARTED" | "IN_PROGRESS" | "COMPLETED" | "OVERDUE";

type ApiInstance = {
  id: string;
  status: ObStatus;
  startDate: string;
  targetDate?: string | null;
  completedAt?: string | null;
  progress: Array<{ stepId?: string; done?: boolean } | unknown> | unknown;
  user?: { id: string; firstName?: string | null; lastName?: string | null; department?: { name?: string | null } | null } | null;
  buddy?: { id: string; firstName?: string | null; lastName?: string | null } | null;
  template?: { name: string; steps?: unknown[]; durationDays?: number } | null;
};

const STATUS_TO_OS: Record<ObStatus, StatusValue> = {
  NOT_STARTED: "planning", IN_PROGRESS: "working", COMPLETED: "done", OVERDUE: "stuck",
};
const STATUS_LABELS: Record<ObStatus, string> = {
  NOT_STARTED: "Not started", IN_PROGRESS: "In progress", COMPLETED: "Completed", OVERDUE: "Overdue",
};
const STATUS_COLORS: Record<ObStatus, string> = {
  NOT_STARTED: C.indigo, IN_PROGRESS: C.orange, COMPLETED: C.green, OVERDUE: C.red,
};

const AV_PALETTE = [C.purple, C.green, C.orange, C.pink, C.teal, C.indigo, C.blue, C.red];
function avColor(s: string) { let h = 0; for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0; return AV_PALETTE[h % AV_PALETTE.length]; }
function initials(f?: string | null, l?: string | null) { const a = (f ?? "")[0] ?? ""; const b = (l ?? "")[0] ?? ""; return ((a + b) || "?").toUpperCase(); }

const GROUP_ORDER: ObStatus[] = ["NOT_STARTED", "IN_PROGRESS", "OVERDUE", "COMPLETED"];

function progressPct(inst: ApiInstance): number {
  const totalSteps = Array.isArray(inst.template?.steps) ? inst.template.steps.length : 0;
  const progress = Array.isArray(inst.progress) ? inst.progress : [];
  const doneSteps = progress.filter((p) => (p as { done?: boolean })?.done === true).length;
  if (totalSteps === 0) return inst.status === "COMPLETED" ? 100 : 0;
  return Math.round((doneSteps / totalSteps) * 100);
}

function instToRow(i: ApiInstance): Row {
  const userName = i.user ? `${i.user.firstName ?? ""} ${i.user.lastName ?? ""}`.trim() || "Unknown" : "—";
  const tplName = i.template?.name ?? "Onboarding";
  const pct = progressPct(i);
  return {
    id: i.id,
    name: `${userName} · ${tplName}`,
    done: i.status === "COMPLETED",
    cells: {
      status: { value: STATUS_TO_OS[i.status], label: STATUS_LABELS[i.status] },
      employee: i.user ? [{ initials: initials(i.user.firstName, i.user.lastName), color: avColor(i.user.id) }] : [],
      buddy: i.buddy ? [{ initials: initials(i.buddy.firstName, i.buddy.lastName), color: avColor(i.buddy.id) }] : [],
      department: i.user?.department?.name ?? "—",
      progress: { pct, color: pct >= 100 ? "green" : pct >= 50 ? "blue" : pct >= 25 ? "warning" : "danger" },
      started: { iso: i.startDate },
      target: i.targetDate ? { iso: i.targetDate } : undefined,
    },
  };
}

function buildGroups(rows: ApiInstance[]): TableGroup[] {
  const buckets = new Map<ObStatus, ApiInstance[]>();
  for (const s of GROUP_ORDER) buckets.set(s, []);
  for (const r of rows) {
    const b = buckets.get(r.status);
    if (b) b.push(r);
  }
  return GROUP_ORDER
    .map((s) => ({
      id: s, title: STATUS_LABELS[s], color: STATUS_COLORS[s],
      rows: (buckets.get(s) ?? []).map(instToRow),
    }))
    .filter((g) => g.rows.length > 0 || g.id === "IN_PROGRESS");
}

const COLUMNS: Column[] = [
  { id: "status",     label: "Status",     type: "status" },
  { id: "employee",   label: "Employee",   type: "person" },
  { id: "buddy",      label: "Buddy",      type: "person" },
  { id: "department", label: "Department", type: "text" },
  { id: "progress",   label: "Progress",   type: "progress" },
  { id: "started",    label: "Started",    type: "date" },
  { id: "target",     label: "Target",     type: "date" },
];

const TABS: TabDef[] = [
  { id: "table",     label: "Main table", Icon: ClipboardList },
  { id: "calendar",  label: "Calendar",   Icon: CalendarIcon },
  { id: "gantt",     label: "Gantt",      Icon: BarChart },
  { id: "dashboard", label: "Dashboard",  Icon: ChartPie },
];

export default function OnboardingPage() {
  const [rows, setRows] = useState<ApiInstance[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState("table");
  const { rowVersion } = useOsShell();
  const { toast } = useOsToast();

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/onboarding");
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      setRows(data.data ?? (Array.isArray(data) ? data : []));
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : "load failed");
    }
  }, []);
  useEffect(() => { void load(); }, [load]);
  const v = rowVersion("onboarding");
  useEffect(() => { if (v > 0) void load(); }, [v, load]);

  const groups = useMemo(() => buildGroups(rows ?? []), [rows]);

  const handlers = {
    onAdd: async (_g: string) => {
      toast("Starting an onboarding needs a template + new-hire — use the recruiting → hired flow");
      throw new Error("not supported");
    },
  };

  const calendarEvents = useMemo<CalendarEvent[]>(
    () => (rows ?? []).map((r): CalendarEvent => ({
      id: r.id,
      title: `${r.user?.firstName ?? ""}'s onboarding`.trim(),
      date: r.targetDate ?? r.startDate,
      color: STATUS_COLORS[r.status],
      done: r.status === "COMPLETED",
      payload: instToRow(r).cells,
    })),
    [rows],
  );

  const activeCount = (rows ?? []).filter((r) => r.status === "IN_PROGRESS").length;
  const overdueCount = (rows ?? []).filter((r) => r.status === "OVERDUE").length;

  return (
    <>
      <OsTitleBar
        title="Onboarding"
        Icon={IdCard}
        iconGradient={GRAD.orangePink}
        description={rows === null ? "Loading journeys…" : `${rows.length} journey${rows.length === 1 ? "" : "s"} · ${activeCount} active · ${overdueCount} overdue`}
        people={[PEOPLE.mk, PEOPLE.bb]}
        morePeople={3}
      />
      <OsTabs tabs={TABS} active={activeTab} onSelect={setActiveTab} />

      {activeTab === "table" && (
        <>
          <OsFilterBar newLabel="Start onboarding" activeFilters={0} />
          {loadError ? (
            <OsEmptyView Icon={IdCard} iconGradient={GRAD.redPink} title="Couldn't load onboarding" subtitle={`API error: ${loadError}.`} cta="Retry" />
          ) : rows === null ? (
            <div style={{ padding: "60px 24px", textAlign: "center", color: "var(--os-ink-3)", fontSize: 13 }}>Loading…</div>
          ) : rows.length === 0 ? (
            <OsEmptyView Icon={IdCard} iconGradient={GRAD.orangePink} title="No onboarding journeys yet" subtitle="When you hire someone in Recruiting, an onboarding instance auto-starts from the matching template." chips={["Templates", "Buddies", "Checklists"]} cta="Set up templates" />
          ) : (
            <OsMainTable moduleId="onboarding" columns={COLUMNS} groups={groups} handlers={handlers} />
          )}
        </>
      )}

      {activeTab === "calendar" && (
        <OsCalendar moduleId="onboarding" events={calendarEvents} newLabel="Start onboarding" />
      )}

      {activeTab !== "table" && activeTab !== "calendar" && (
        <OsEmptyView Icon={IdCard} iconGradient={GRAD.orangePink} title={`${TABS.find((t) => t.id === activeTab)?.label ?? "View"} coming soon`} subtitle="Shares live data with Main table." chips={["Live data"]} cta="Back to Main table" />
      )}
    </>
  );
}
