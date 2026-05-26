"use client";

/* Real Inbox page (your notifications).
 *
 *  GET    /api/notifications           list visible to me (top 50, snooze-aware)
 *  PATCH  /api/notifications           { id, markAllRead? } — mark read
 *  DELETE /api/notifications           { id?, allRead? }
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { Inbox, ClipboardList, ChartPie, BarChart, Calendar as CalendarIcon } from "lucide-react";
import { OsTitleBar } from "@/components/layout/os/title-bar";
import { OsTabs, type TabDef } from "@/components/layout/os/tabs";
import { OsFilterBar } from "@/components/layout/os/filter-bar";
import { OsMainTable, type Column, type TableGroup, type Row } from "@/components/layout/os/main-table";
import { OsCalendar, type CalendarEvent } from "@/components/layout/os/calendar";
import { OsEmptyView } from "@/components/layout/os/empty-view";
import { C, GRAD, PEOPLE } from "@/components/layout/os/catalog";
import { useOsShell } from "@/components/layout/os/shell-context";
import { useOsToast } from "@/components/layout/os/toast";

type ApiNotification = {
  id: string;
  userId: string;
  type: string;
  title: string;
  message?: string | null;
  link?: string | null;
  read: boolean;
  snoozedUntil?: string | null;
  createdAt: string;
};

const TYPE_COLORS: Record<string, string> = {
  kudos: C.pink, mention: C.purple, task_assigned: C.blue,
  task_due: C.orange, candor_session: C.indigo, survey: C.teal,
  approval: C.red, sop_published: C.green, default: C.gray,
};

function typeColor(t: string): string {
  return TYPE_COLORS[t] ?? TYPE_COLORS.default;
}

function notifToRow(n: ApiNotification): Row {
  return {
    id: n.id,
    name: n.title + (n.message ? ` — ${n.message.length > 80 ? n.message.slice(0, 80) + "…" : n.message}` : ""),
    done: n.read,
    cells: {
      type: n.type.replace(/_/g, " "),
      link: n.link ?? "—",
      read: n.read ? "Read" : "Unread",
      when: { iso: n.createdAt },
    },
  };
}

function buildGroups(rows: ApiNotification[]): TableGroup[] {
  const unread = rows.filter((n) => !n.read);
  const read = rows.filter((n) => n.read);
  const groups: TableGroup[] = [];
  if (unread.length > 0 || read.length === 0) {
    groups.push({ id: "unread", title: "Unread", color: C.orange, rows: unread.map(notifToRow) });
  }
  if (read.length > 0) {
    groups.push({ id: "read", title: "Read", color: C.gray, rows: read.map(notifToRow) });
  }
  return groups;
}

const COLUMNS: Column[] = [
  { id: "type", label: "Type", type: "text" },
  { id: "link", label: "Link", type: "text" },
  { id: "read", label: "State", type: "text" },
  { id: "when", label: "When", type: "date" },
];

const TABS: TabDef[] = [
  { id: "table",     label: "Main table", Icon: ClipboardList },
  { id: "calendar",  label: "Calendar",   Icon: CalendarIcon },
  { id: "gantt",     label: "Gantt",      Icon: BarChart },
  { id: "dashboard", label: "Dashboard",  Icon: ChartPie },
];

export default function InboxPage() {
  const [rows, setRows] = useState<ApiNotification[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState("table");
  const { rowVersion } = useOsShell();
  const { toast } = useOsToast();

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/notifications");
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      setRows(data.notifications ?? data.data ?? (Array.isArray(data) ? data : []));
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : "load failed");
    }
  }, []);
  useEffect(() => { void load(); }, [load]);
  const v = rowVersion("inbox");
  useEffect(() => { if (v > 0) void load(); }, [v, load]);

  const groups = useMemo(() => buildGroups(rows ?? []), [rows]);

  const handlers = {
    onToggleDone: async (rowId: string, _g: string, done: boolean) => {
      if (!done) {
        toast("Notifications can be marked read — re-opening isn't supported");
        throw new Error("not supported");
      }
      const res = await fetch("/api/notifications", {
        method: "PATCH", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: rowId }),
      });
      if (!res.ok) throw new Error(`PATCH ${res.status}`);
      void load();
    },
    onAdd: async (_g: string) => {
      toast("Notifications arrive from your modules — nothing to add manually");
      throw new Error("not supported");
    },
  };

  const calendarEvents = useMemo<CalendarEvent[]>(
    () => (rows ?? []).map((n): CalendarEvent => ({
      id: n.id,
      title: n.title,
      date: n.createdAt,
      color: typeColor(n.type),
      done: n.read,
      payload: notifToRow(n).cells,
    })),
    [rows],
  );

  const unreadCount = (rows ?? []).filter((n) => !n.read).length;

  return (
    <>
      <OsTitleBar
        title="Inbox"
        Icon={Inbox}
        iconGradient={GRAD.indigoBlue}
        description={rows === null ? "Loading inbox…" : `${rows.length} notification${rows.length === 1 ? "" : "s"}${unreadCount > 0 ? ` · ${unreadCount} unread` : " · all caught up"}`}
        people={[PEOPLE.bb]}
        morePeople={0}
      />
      <OsTabs tabs={TABS} active={activeTab} onSelect={setActiveTab} />

      {activeTab === "table" && (
        <>
          <OsFilterBar newLabel="" activeFilters={0} />
          {loadError ? (
            <OsEmptyView Icon={Inbox} iconGradient={GRAD.redPink} title="Couldn't load inbox" subtitle={`API error: ${loadError}.`} cta="Retry" />
          ) : rows === null ? (
            <div style={{ padding: "60px 24px", textAlign: "center", color: "var(--os-ink-3)", fontSize: 13 }}>Loading…</div>
          ) : rows.length === 0 ? (
            <OsEmptyView Icon={Inbox} iconGradient={GRAD.indigoBlue} title="Inbox zero" subtitle="@-mentions, kudos, assignments, survey requests, and approval pings show up here. You're all clear." chips={["Mentions", "Kudos", "Assignments", "Approvals"]} cta="Explore modules" />
          ) : (
            <OsMainTable moduleId="inbox" columns={COLUMNS} groups={groups} handlers={handlers} />
          )}
        </>
      )}

      {activeTab === "calendar" && (
        <OsCalendar moduleId="inbox" events={calendarEvents} newLabel="" />
      )}

      {activeTab !== "table" && activeTab !== "calendar" && (
        <OsEmptyView Icon={Inbox} iconGradient={GRAD.indigoBlue} title={`${TABS.find((t) => t.id === activeTab)?.label ?? "View"} coming soon`} subtitle="Shares live data with Main table." chips={["Live data"]} cta="Back to Main table" />
      )}
    </>
  );
}
