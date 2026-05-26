"use client";

/* Real Kudos page.
 *
 *  GET  /api/kudos             list (shaped: { giver, receiver, reactionCounts, ... })
 *  POST /api/kudos             { receiverId, message, companyValue? }
 *
 *  No status field — kudos are immutable shout-outs. We bucket by
 *  "Recent" (last 7 days) and then by month, so the feed reads
 *  chronologically.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { Heart, ClipboardList, ChartPie, BarChart, Calendar as CalendarIcon } from "lucide-react";
import { OsTitleBar } from "@/components/layout/os/title-bar";
import { OsTabs, type TabDef } from "@/components/layout/os/tabs";
import { OsFilterBar } from "@/components/layout/os/filter-bar";
import { OsMainTable, type Column, type TableGroup, type Row } from "@/components/layout/os/main-table";
import { OsCalendar, type CalendarEvent } from "@/components/layout/os/calendar";
import { OsEmptyView } from "@/components/layout/os/empty-view";
import { C, GRAD, PEOPLE } from "@/components/layout/os/catalog";
import { useOsShell } from "@/components/layout/os/shell-context";
import { useOsToast } from "@/components/layout/os/toast";

type ApiKudos = {
  id: string;
  message: string;
  companyValue?: string | null;
  createdAt: string;
  totalReactions: number;
  reactionCounts: { emoji: string; count: number }[];
  myReactions: string[];
  giver?: { id: string; firstName?: string | null; lastName?: string | null } | null;
  receiver?: { id: string; firstName?: string | null; lastName?: string | null; department?: { name?: string | null } | null } | null;
};

const AV = [C.purple, C.green, C.orange, C.pink, C.teal, C.indigo, C.blue, C.red];
function avColor(s: string) { let h = 0; for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0; return AV[h % AV.length]; }
function initials(f?: string | null, l?: string | null) { const a = (f ?? "")[0] ?? ""; const b = (l ?? "")[0] ?? ""; return ((a + b) || "?").toUpperCase(); }
function fullName(u?: { firstName?: string | null; lastName?: string | null } | null) {
  if (!u) return "—";
  return `${u.firstName ?? ""} ${u.lastName ?? ""}`.trim() || "Unknown";
}

const MS_DAY = 86400_000;

function kudosToRow(k: ApiKudos): Row {
  const reactionsSummary = k.reactionCounts.slice(0, 3).map((r) => `${r.emoji} ${r.count}`).join(" ");
  return {
    id: k.id,
    name: k.message,
    cells: {
      from: k.giver ? [{ initials: initials(k.giver.firstName, k.giver.lastName), color: avColor(k.giver.id) }] : [],
      to:   k.receiver ? [{ initials: initials(k.receiver.firstName, k.receiver.lastName), color: avColor(k.receiver.id) }] : [],
      receiverName: fullName(k.receiver),
      value: k.companyValue ?? "—",
      reactions: reactionsSummary || (k.totalReactions ? `${k.totalReactions} 👏` : "—"),
      date: { iso: k.createdAt },
    },
  };
}

function buildGroups(rows: ApiKudos[]): TableGroup[] {
  const now = Date.now();
  const recent = rows.filter((k) => now - new Date(k.createdAt).getTime() <= 7 * MS_DAY);
  const older = rows.filter((k) => now - new Date(k.createdAt).getTime() > 7 * MS_DAY);
  return [
    { id: "recent", title: "Recent (last 7 days)", color: C.pink,   rows: recent.map(kudosToRow) },
    { id: "older",  title: "Earlier",              color: C.purple, rows: older.map(kudosToRow) },
  ].filter((g) => g.rows.length > 0 || g.id === "recent");
}

const COLUMNS: Column[] = [
  { id: "from",         label: "From",          type: "person" },
  { id: "to",           label: "To",            type: "person" },
  { id: "receiverName", label: "Receiver",      type: "text" },
  { id: "value",        label: "Company value", type: "text" },
  { id: "reactions",    label: "Reactions",     type: "text" },
  { id: "date",         label: "Given",         type: "date" },
];

const TABS: TabDef[] = [
  { id: "table",     label: "Feed",       Icon: ClipboardList },
  { id: "calendar",  label: "Calendar",   Icon: CalendarIcon },
  { id: "gantt",     label: "Gantt",      Icon: BarChart },
  { id: "dashboard", label: "Dashboard",  Icon: ChartPie },
];

export default function KudosPage() {
  const [rows, setRows] = useState<ApiKudos[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState("table");
  const { rowVersion } = useOsShell();
  const { toast } = useOsToast();

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/kudos?limit=50");
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      // Kudos GET returns { data, pagination }
      const list: ApiKudos[] = data?.data ?? (Array.isArray(data) ? data : []);
      setRows(list);
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : "load failed");
    }
  }, []);
  useEffect(() => { void load(); }, [load]);
  const v = rowVersion("kudos");
  useEffect(() => { if (v > 0) void load(); }, [v, load]);

  const groups = useMemo(() => buildGroups(rows ?? []), [rows]);

  const handlers = {
    onAdd: async (_g: string) => {
      toast("Sending kudos needs a receiver — use the +Kudos button on People");
      throw new Error("not supported");
    },
  };

  const calendarEvents = useMemo<CalendarEvent[]>(
    () => (rows ?? []).map((k): CalendarEvent => ({
      id: k.id,
      title: `${initials(k.giver?.firstName, k.giver?.lastName)} → ${fullName(k.receiver)}`,
      date: k.createdAt,
      color: C.pink,
      payload: kudosToRow(k).cells,
    })),
    [rows],
  );

  const weekCount = (rows ?? []).filter((k) => Date.now() - new Date(k.createdAt).getTime() <= 7 * MS_DAY).length;

  return (
    <>
      <OsTitleBar
        title="Kudos"
        Icon={Heart}
        iconGradient={GRAD.redPink}
        description={rows === null ? "Loading kudos…" : `${rows.length} kudos${rows.length === 1 ? "" : "s"} · ${weekCount} this week · live-synced`}
        people={[PEOPLE.bb, PEOPLE.mk, PEOPLE.pr]}
        morePeople={9}
      />
      <OsTabs tabs={TABS} active={activeTab} onSelect={setActiveTab} />

      {activeTab === "table" && (
        <>
          <OsFilterBar newLabel="Send kudos" activeFilters={0} />
          {loadError ? (
            <OsEmptyView Icon={Heart} iconGradient={GRAD.redPink} title="Couldn't load kudos" subtitle={`API error: ${loadError}.`} cta="Retry" />
          ) : rows === null ? (
            <div style={{ padding: "60px 24px", textAlign: "center", color: "var(--os-ink-3)", fontSize: 13 }}>Loading…</div>
          ) : rows.length === 0 ? (
            <OsEmptyView Icon={Heart} iconGradient={GRAD.redPink} title="No kudos yet" subtitle="Recognize a teammate's work. Pick a company value to reinforce the behavior you want to celebrate." chips={["Customer First", "Ownership", "Teamwork", "Boldness"]} cta="Send kudos" />
          ) : (
            <OsMainTable moduleId="kudos" columns={COLUMNS} groups={groups} handlers={handlers} />
          )}
        </>
      )}

      {activeTab === "calendar" && (
        <OsCalendar moduleId="kudos" events={calendarEvents} newLabel="Send kudos" />
      )}

      {activeTab !== "table" && activeTab !== "calendar" && (
        <OsEmptyView Icon={Heart} iconGradient={GRAD.redPink} title={`${TABS.find((t) => t.id === activeTab)?.label ?? "View"} coming soon`} subtitle="Shares live data with the feed." chips={["Live data"]} cta="Back to Feed" />
      )}
    </>
  );
}
