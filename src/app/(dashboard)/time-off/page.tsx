"use client";

/* Real, persistent Time-off page.
 *
 *  GET  /api/time-off              list requests
 *  POST /api/time-off/[id]/decide  { decision: APPROVE | REJECT }  (manager+)
 *
 *  Status enum: PENDING | APPROVED | REJECTED | CANCELLED
 *  Type enum:   PTO | SICK | PERSONAL | BEREAVEMENT | PARENTAL | UNPAID | OTHER
 *
 *  New requests require a policy + dates — too multi-step for inline +Add.
 *  Surface a friendly toast pointing to the request flow.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { Plane, ClipboardList, ChartPie, BarChart, Calendar as CalendarIcon } from "lucide-react";
import { OsTitleBar } from "@/components/layout/os/title-bar";
import { OsTabs, type TabDef } from "@/components/layout/os/tabs";
import { OsFilterBar } from "@/components/layout/os/filter-bar";
import { OsMainTable, type Column, type TableGroup, type Row, type StatusValue } from "@/components/layout/os/main-table";
import { OsCalendar, type CalendarEvent } from "@/components/layout/os/calendar";
import { OsEmptyView } from "@/components/layout/os/empty-view";
import { C, GRAD, PEOPLE } from "@/components/layout/os/catalog";
import { useOsShell } from "@/components/layout/os/shell-context";
import { useOsToast } from "@/components/layout/os/toast";
import type { PickerOption } from "@/components/layout/os/picker-popover";

type ToStatus = "PENDING" | "APPROVED" | "REJECTED" | "CANCELLED";

type ApiRequest = {
  id: string;
  startDate: string;
  endDate: string;
  hours: number;
  reason?: string | null;
  status: ToStatus;
  decisionAt?: string | null;
  decisionNote?: string | null;
  user?: { id: string; firstName?: string | null; lastName?: string | null } | null;
  approver?: { id: string; firstName?: string | null; lastName?: string | null } | null;
  policy?: { id: string; name: string; type: string; color?: string | null } | null;
};

const STATUS_TO_OS: Record<ToStatus, StatusValue> = {
  PENDING: "pending", APPROVED: "done", REJECTED: "stuck", CANCELLED: "empty",
};
const STATUS_LABELS: Record<ToStatus, string> = {
  PENDING: "Pending", APPROVED: "Approved", REJECTED: "Rejected", CANCELLED: "Cancelled",
};
const STATUS_COLORS: Record<ToStatus, string> = {
  PENDING: C.yellow, APPROVED: C.green, REJECTED: C.red, CANCELLED: C.gray,
};
const STATUS_OPTIONS: PickerOption[] = (["PENDING", "APPROVED", "REJECTED"] as ToStatus[]).map((s) => ({
  value: s, label: STATUS_LABELS[s], color: STATUS_COLORS[s],
}));

const AV_PALETTE = [C.purple, C.green, C.orange, C.pink, C.teal, C.indigo, C.blue, C.red];
function avColor(s: string) { let h = 0; for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0; return AV_PALETTE[h % AV_PALETTE.length]; }
function initials(f?: string | null, l?: string | null) { const a = (f ?? "")[0] ?? ""; const b = (l ?? "")[0] ?? ""; return ((a + b) || "?").toUpperCase(); }

const GROUP_ORDER: ToStatus[] = ["PENDING", "APPROVED", "REJECTED"];

function reqToRow(r: ApiRequest): Row {
  const days = Math.round(r.hours / 8);
  return {
    id: r.id,
    name: `${r.policy?.name ?? "Time off"}${r.reason ? ` — ${r.reason}` : ""}`,
    done: r.status === "APPROVED",
    cells: {
      status: { value: STATUS_TO_OS[r.status], label: STATUS_LABELS[r.status] },
      type: r.policy?.type?.replace(/_/g, " ") ?? "—",
      employee: r.user ? [{ initials: initials(r.user.firstName, r.user.lastName), color: avColor(r.user.id) }] : [],
      approver: r.approver ? [{ initials: initials(r.approver.firstName, r.approver.lastName), color: avColor(r.approver.id) }] : [],
      duration: `${r.hours}h${days ? ` · ${days}d` : ""}`,
      start: r.startDate ? { iso: r.startDate } : undefined,
      end: r.endDate ? { iso: r.endDate } : undefined,
    },
  };
}

function buildGroups(reqs: ApiRequest[]): TableGroup[] {
  const buckets = new Map<ToStatus, ApiRequest[]>();
  for (const s of GROUP_ORDER) buckets.set(s, []);
  for (const r of reqs) {
    if (r.status === "CANCELLED") continue;
    const b = buckets.get(r.status);
    if (b) b.push(r);
  }
  return GROUP_ORDER
    .map((s) => ({
      id: s, title: STATUS_LABELS[s], color: STATUS_COLORS[s],
      rows: (buckets.get(s) ?? []).map(reqToRow),
    }))
    .filter((g) => g.rows.length > 0 || g.id === "PENDING");
}

const COLUMNS: Column[] = [
  { id: "status",   label: "Status",   type: "status" },
  { id: "type",     label: "Type",     type: "text" },
  { id: "employee", label: "Employee", type: "person" },
  { id: "approver", label: "Approver", type: "person" },
  { id: "duration", label: "Duration", type: "text" },
  { id: "start",    label: "Starts",   type: "date" },
  { id: "end",      label: "Ends",     type: "date" },
];

const TABS: TabDef[] = [
  { id: "table",     label: "Main table", Icon: ClipboardList },
  { id: "calendar",  label: "Calendar",   Icon: CalendarIcon },
  { id: "gantt",     label: "Gantt",      Icon: BarChart },
  { id: "dashboard", label: "Dashboard",  Icon: ChartPie },
];

export default function TimeOffPage() {
  const [reqs, setReqs] = useState<ApiRequest[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState("table");
  const { rowVersion } = useOsShell();
  const { toast } = useOsToast();

  const load = useCallback(async () => {
    try {
      // Try team scope first (managers); fall back to mine
      let res = await fetch("/api/time-off?scope=team");
      if (res.status === 403 || res.status === 400) {
        res = await fetch("/api/time-off?scope=mine");
      }
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      const list: ApiRequest[] = data?.data ?? (Array.isArray(data) ? data : []);
      setReqs(list);
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : "load failed");
    }
  }, []);
  useEffect(() => { void load(); }, [load]);
  const v = rowVersion("time-off");
  useEffect(() => { if (v > 0) void load(); }, [v, load]);

  const groups = useMemo(() => buildGroups(reqs ?? []), [reqs]);

  async function decide(id: string, decision: "APPROVE" | "REJECT"): Promise<boolean> {
    try {
      const res = await fetch(`/api/time-off/${id}/decide`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ decision }),
      });
      if (!res.ok) {
        if (res.status === 403) toast("Only managers can decide on requests");
        return false;
      }
      void load();
      return true;
    } catch { return false; }
  }

  const handlers = {
    onStatusChange: async (rowId: string, _g: string, value: string) => {
      const r = (reqs ?? []).find((x) => x.id === rowId);
      if (!r) return;
      if (r.status !== "PENDING") {
        toast(`Can't change a ${STATUS_LABELS[r.status]} request`);
        throw new Error("illegal");
      }
      if (value !== "APPROVED" && value !== "REJECTED") {
        toast("Requests can only be approved or rejected from pending");
        throw new Error("illegal");
      }
      const ok = await decide(rowId, value === "APPROVED" ? "APPROVE" : "REJECT");
      if (!ok) throw new Error("decide failed");
    },
    onAdd: async (_g: string) => {
      toast("Time-off requests need a policy + dates — use the request flow");
      throw new Error("not supported");
    },
  };

  const calendarEvents = useMemo<CalendarEvent[]>(
    () => (reqs ?? [])
      .filter((r) => r.startDate)
      .map((r): CalendarEvent => ({
        id: r.id,
        title: `${r.user?.firstName ?? ""} · ${r.policy?.name ?? "Time off"}`.trim(),
        date: r.startDate,
        color: STATUS_COLORS[r.status],
        done: r.status === "APPROVED",
        payload: reqToRow(r).cells,
      })),
    [reqs],
  );

  const pendingCount = (reqs ?? []).filter((r) => r.status === "PENDING").length;

  return (
    <>
      <OsTitleBar
        title="Time off"
        Icon={Plane}
        iconGradient={GRAD.bluePurple}
        description={reqs === null ? "Loading requests…" : `${reqs.length} request${reqs.length === 1 ? "" : "s"} · ${pendingCount} pending · live-synced`}
        people={[PEOPLE.bb, PEOPLE.mk]}
        morePeople={5}
      />
      <OsTabs tabs={TABS} active={activeTab} onSelect={setActiveTab} />

      {activeTab === "table" && (
        <>
          <OsFilterBar newLabel="Request time off" activeFilters={0} />
          {loadError ? (
            <OsEmptyView Icon={Plane} iconGradient={GRAD.redPink} title="Couldn't load requests" subtitle={`API error: ${loadError}.`} cta="Retry" />
          ) : reqs === null ? (
            <div style={{ padding: "60px 24px", textAlign: "center", color: "var(--os-ink-3)", fontSize: 13 }}>Loading…</div>
          ) : reqs.length === 0 ? (
            <OsEmptyView Icon={Plane} iconGradient={GRAD.bluePurple} title="No time-off requests yet" subtitle="When teammates request PTO, sick days, or parental leave, those requests show up here for approval." chips={["PTO", "Sick", "Parental", "Bereavement"]} cta="Request time off" />
          ) : (
            <OsMainTable moduleId="time-off" columns={COLUMNS} groups={groups} statusOptions={STATUS_OPTIONS} handlers={handlers} />
          )}
        </>
      )}

      {activeTab === "calendar" && (
        <OsCalendar moduleId="time-off" events={calendarEvents} newLabel="Request time off" />
      )}

      {activeTab !== "table" && activeTab !== "calendar" && (
        <OsEmptyView Icon={Plane} iconGradient={GRAD.bluePurple} title={`${TABS.find((t) => t.id === activeTab)?.label ?? "View"} coming soon`} subtitle="Shares live data with Main table." chips={["Live data", "Persistent edits"]} cta="Back to Main table" />
      )}
    </>
  );
}
