"use client";

/* Real, persistent Ideas page.
 *
 *  GET   /api/ideas               list
 *  POST  /api/ideas               { title, description, category? }
 *  PATCH /api/ideas/[id]          { status?, reviewNotes?, ... } (manager)
 *                                 { title?, description?, category? } (submitter)
 *
 *  Status enum: SUBMITTED | UNDER_REVIEW | APPROVED | REJECTED | IMPLEMENTED | REWARDED
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { Lightbulb, ClipboardList, ChartPie, BarChart, Calendar as CalendarIcon } from "lucide-react";
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

type IdStatus = "SUBMITTED" | "UNDER_REVIEW" | "APPROVED" | "REJECTED" | "IMPLEMENTED" | "REWARDED";

type ApiIdea = {
  id: string;
  title: string;
  description: string;
  category?: string | null;
  status: IdStatus;
  rewardType?: string | null;
  rewardValue?: string | null;
  rewardedAt?: string | null;
  createdAt: string;
  submitter?: { id: string; firstName?: string | null; lastName?: string | null; department?: { name?: string | null } | null } | null;
  reviewer?: { id: string; firstName?: string | null; lastName?: string | null } | null;
  votes?: { userId: string }[];
  _count?: { votes?: number; comments?: number };
};

const STATUS_TO_OS: Record<IdStatus, StatusValue> = {
  SUBMITTED: "planning", UNDER_REVIEW: "review", APPROVED: "progress",
  REJECTED: "stuck", IMPLEMENTED: "done", REWARDED: "shipped",
};
const STATUS_LABELS: Record<IdStatus, string> = {
  SUBMITTED: "Submitted", UNDER_REVIEW: "Under review", APPROVED: "Approved",
  REJECTED: "Rejected", IMPLEMENTED: "Implemented", REWARDED: "Rewarded",
};
const STATUS_COLORS: Record<IdStatus, string> = {
  SUBMITTED: C.indigo, UNDER_REVIEW: C.purple, APPROVED: C.blue,
  REJECTED: C.red, IMPLEMENTED: C.green, REWARDED: C.pink,
};
const STATUS_OPTIONS: PickerOption[] = (Object.keys(STATUS_LABELS) as IdStatus[]).map((s) => ({
  value: s, label: STATUS_LABELS[s], color: STATUS_COLORS[s],
}));

const AV_PALETTE = [C.purple, C.green, C.orange, C.pink, C.teal, C.indigo, C.blue, C.red];
function avColor(s: string) { let h = 0; for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0; return AV_PALETTE[h % AV_PALETTE.length]; }
function initials(f?: string | null, l?: string | null) { const a = (f ?? "")[0] ?? ""; const b = (l ?? "")[0] ?? ""; return ((a + b) || "?").toUpperCase(); }

const GROUP_ORDER: IdStatus[] = ["SUBMITTED", "UNDER_REVIEW", "APPROVED", "IMPLEMENTED", "REWARDED", "REJECTED"];

function ideaToRow(i: ApiIdea): Row {
  return {
    id: i.id,
    name: i.title,
    done: i.status === "IMPLEMENTED" || i.status === "REWARDED",
    cells: {
      status: { value: STATUS_TO_OS[i.status], label: STATUS_LABELS[i.status] },
      submitter: i.submitter ? [{ initials: initials(i.submitter.firstName, i.submitter.lastName), color: avColor(i.submitter.id) }] : [],
      category: i.category ?? "—",
      department: i.submitter?.department?.name ?? "—",
      votes: `${i._count?.votes ?? 0} ▲`,
      comments: `${i._count?.comments ?? 0} 💬`,
      submitted: { iso: i.createdAt },
    },
  };
}

function buildGroups(rows: ApiIdea[]): TableGroup[] {
  const buckets = new Map<IdStatus, ApiIdea[]>();
  for (const s of GROUP_ORDER) buckets.set(s, []);
  for (const i of rows) {
    const b = buckets.get(i.status);
    if (b) b.push(i);
  }
  return GROUP_ORDER
    .map((s) => ({
      id: s, title: STATUS_LABELS[s], color: STATUS_COLORS[s],
      rows: (buckets.get(s) ?? []).map(ideaToRow),
    }))
    .filter((g) => g.rows.length > 0 || g.id === "SUBMITTED" || g.id === "UNDER_REVIEW");
}

const COLUMNS: Column[] = [
  { id: "status",     label: "Status",     type: "status" },
  { id: "submitter",  label: "Submitter",  type: "person" },
  { id: "category",   label: "Category",   type: "text" },
  { id: "department", label: "Department", type: "text" },
  { id: "votes",      label: "Votes",      type: "text" },
  { id: "comments",   label: "Comments",   type: "text" },
  { id: "submitted",  label: "Submitted",  type: "date" },
];

const TABS: TabDef[] = [
  { id: "table",     label: "Main table", Icon: ClipboardList },
  { id: "calendar",  label: "Calendar",   Icon: CalendarIcon },
  { id: "gantt",     label: "Gantt",      Icon: BarChart },
  { id: "dashboard", label: "Dashboard",  Icon: ChartPie },
];

export default function IdeasPage() {
  const [rows, setRows] = useState<ApiIdea[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState("table");
  const { rowVersion } = useOsShell();
  const { toast } = useOsToast();

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/ideas");
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      setRows(data.data ?? (Array.isArray(data) ? data : []));
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : "load failed");
    }
  }, []);
  useEffect(() => { void load(); }, [load]);
  const v = rowVersion("ideas");
  useEffect(() => { if (v > 0) void load(); }, [v, load]);

  const groups = useMemo(() => buildGroups(rows ?? []), [rows]);

  async function patch(id: string, body: Record<string, unknown>): Promise<boolean> {
    try {
      const res = await fetch(`/api/ideas/${id}`, {
        method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
      });
      if (!res.ok) {
        if (res.status === 403) toast("Status changes require manager role");
        return false;
      }
      void load();
      return true;
    } catch { return false; }
  }

  const handlers = {
    onStatusChange: async (rowId: string, _g: string, value: string) => {
      const ok = await patch(rowId, { status: value });
      if (!ok) throw new Error("save failed");
    },
    onRename: async (rowId: string, _g: string, name: string) => {
      const ok = await patch(rowId, { title: name });
      if (!ok) throw new Error("save failed");
    },
    onAdd: async (_groupId: string) => {
      const res = await fetch("/api/ideas", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: "Untitled idea", description: "What's the idea? Why does it matter?" }),
      });
      if (!res.ok) throw new Error(`POST ${res.status}`);
      const data = await res.json();
      const i: ApiIdea = data.data ?? data;
      setTimeout(() => void load(), 200);
      return { id: i.id, name: i.title };
    },
  };

  const calendarEvents = useMemo<CalendarEvent[]>(
    () => (rows ?? []).map((i): CalendarEvent => ({
      id: i.id,
      title: i.title,
      date: i.createdAt,
      color: STATUS_COLORS[i.status],
      done: i.status === "IMPLEMENTED" || i.status === "REWARDED",
      payload: ideaToRow(i).cells,
    })),
    [rows],
  );

  const openCount = (rows ?? []).filter((i) => i.status === "SUBMITTED" || i.status === "UNDER_REVIEW").length;
  const totalVotes = (rows ?? []).reduce((acc, i) => acc + (i._count?.votes ?? 0), 0);

  return (
    <>
      <OsTitleBar
        title="Ideas"
        Icon={Lightbulb}
        iconGradient={GRAD.yellowOrange}
        description={rows === null ? "Loading ideas…" : `${rows.length} idea${rows.length === 1 ? "" : "s"} · ${openCount} open · ${totalVotes} votes`}
        people={[PEOPLE.bb, PEOPLE.sc, PEOPLE.ak]}
        morePeople={9}
      />
      <OsTabs tabs={TABS} active={activeTab} onSelect={setActiveTab} />

      {activeTab === "table" && (
        <>
          <OsFilterBar newLabel="Submit idea" activeFilters={0} />
          {loadError ? (
            <OsEmptyView Icon={Lightbulb} iconGradient={GRAD.redPink} title="Couldn't load ideas" subtitle={`API error: ${loadError}.`} cta="Retry" />
          ) : rows === null ? (
            <div style={{ padding: "60px 24px", textAlign: "center", color: "var(--os-ink-3)", fontSize: 13 }}>Loading…</div>
          ) : rows.length === 0 ? (
            <OsEmptyView Icon={Lightbulb} iconGradient={GRAD.yellowOrange} title="No ideas yet" subtitle="Got an idea to make the company better? Submit it. Teammates vote, managers review and reward implementations." chips={["Vote", "Comment", "Review", "Reward"]} cta="Submit idea" />
          ) : (
            <OsMainTable moduleId="ideas" columns={COLUMNS} groups={groups} statusOptions={STATUS_OPTIONS} handlers={handlers} />
          )}
        </>
      )}

      {activeTab === "calendar" && (
        <OsCalendar moduleId="ideas" events={calendarEvents} newLabel="Submit idea" />
      )}

      {activeTab !== "table" && activeTab !== "calendar" && (
        <OsEmptyView Icon={Lightbulb} iconGradient={GRAD.yellowOrange} title={`${TABS.find((t) => t.id === activeTab)?.label ?? "View"} coming soon`} subtitle="Shares live data with Main table." chips={["Live data"]} cta="Back to Main table" />
      )}
    </>
  );
}
