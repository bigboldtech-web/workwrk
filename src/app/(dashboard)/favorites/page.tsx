"use client";

/* Real Favorites page (pinned Sidekick chat sessions).
 *
 *  GET /api/sidekick/sessions  → list all my chats (pinned first)
 *
 *  WorkwrK doesn't have a dedicated Favorite model yet — until cross-module
 *  starring ships, this surfaces pinned chat sessions, which is the most
 *  common "favorite" people actually use today.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { Star, ClipboardList, ChartPie, BarChart, Calendar as CalendarIcon } from "lucide-react";
import { OsTitleBar } from "@/components/layout/os/title-bar";
import { OsTabs, type TabDef } from "@/components/layout/os/tabs";
import { OsFilterBar } from "@/components/layout/os/filter-bar";
import { OsMainTable, type Column, type TableGroup, type Row } from "@/components/layout/os/main-table";
import { OsCalendar, type CalendarEvent } from "@/components/layout/os/calendar";
import { OsEmptyView } from "@/components/layout/os/empty-view";
import { C, GRAD, PEOPLE } from "@/components/layout/os/catalog";
import { useOsShell } from "@/components/layout/os/shell-context";
import { useOsToast } from "@/components/layout/os/toast";

type ApiSession = {
  id: string;
  title: string | null;
  pinned: boolean;
  lastModel?: string | null;
  totalTokensIn?: number;
  totalTokensOut?: number;
  createdAt: string;
  updatedAt: string;
};

function tokenCount(n?: number): string {
  if (!n || n < 1000) return `${n ?? 0}`;
  if (n < 1_000_000) return `${(n / 1000).toFixed(1)}k`;
  return `${(n / 1_000_000).toFixed(1)}M`;
}

function sessToRow(s: ApiSession): Row {
  const inT = s.totalTokensIn ?? 0;
  const outT = s.totalTokensOut ?? 0;
  return {
    id: s.id,
    name: s.title ?? "Untitled chat",
    done: !s.pinned,
    cells: {
      pinned: s.pinned ? "★ Pinned" : "—",
      model: s.lastModel ?? "—",
      tokens: `${tokenCount(inT + outT)} total`,
      created: { iso: s.createdAt },
      updated: { iso: s.updatedAt },
    },
  };
}

function buildGroups(rows: ApiSession[]): TableGroup[] {
  const pinned = rows.filter((s) => s.pinned);
  const recent = rows.filter((s) => !s.pinned);
  const groups: TableGroup[] = [];
  if (pinned.length > 0 || recent.length === 0) {
    groups.push({ id: "pinned", title: "Pinned", color: C.yellow, rows: pinned.map(sessToRow) });
  }
  if (recent.length > 0) {
    groups.push({ id: "recent", title: "Recent chats", color: C.indigo, rows: recent.map(sessToRow) });
  }
  return groups;
}

const COLUMNS: Column[] = [
  { id: "pinned",  label: "Star",    type: "text" },
  { id: "model",   label: "Model",   type: "text" },
  { id: "tokens",  label: "Tokens",  type: "text" },
  { id: "created", label: "Created", type: "date" },
  { id: "updated", label: "Updated", type: "date" },
];

const TABS: TabDef[] = [
  { id: "table",     label: "Main table", Icon: ClipboardList },
  { id: "calendar",  label: "Calendar",   Icon: CalendarIcon },
  { id: "gantt",     label: "Gantt",      Icon: BarChart },
  { id: "dashboard", label: "Dashboard",  Icon: ChartPie },
];

export default function FavoritesPage() {
  const [rows, setRows] = useState<ApiSession[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState("table");
  const { rowVersion } = useOsShell();
  const { toast } = useOsToast();

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/sidekick/sessions");
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      setRows(data.sessions ?? data.data ?? (Array.isArray(data) ? data : []));
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : "load failed");
    }
  }, []);
  useEffect(() => { void load(); }, [load]);
  const v = rowVersion("favorites");
  useEffect(() => { if (v > 0) void load(); }, [v, load]);

  const groups = useMemo(() => buildGroups(rows ?? []), [rows]);

  const handlers = {
    onAdd: async (_g: string) => {
      toast("Open Sidekick and pin a chat to save it here");
      throw new Error("not supported");
    },
  };

  const calendarEvents = useMemo<CalendarEvent[]>(
    () => (rows ?? []).map((s): CalendarEvent => ({
      id: s.id,
      title: s.title ?? "Untitled chat",
      date: s.updatedAt,
      color: s.pinned ? C.yellow : C.indigo,
      done: !s.pinned,
      payload: sessToRow(s).cells,
    })),
    [rows],
  );

  const pinnedCount = (rows ?? []).filter((s) => s.pinned).length;

  return (
    <>
      <OsTitleBar
        title="Favorites"
        Icon={Star}
        iconGradient={GRAD.yellowOrange}
        description={rows === null ? "Loading favorites…" : `${pinnedCount} pinned · ${rows.length} recent chat${rows.length === 1 ? "" : "s"}`}
        people={[PEOPLE.bb]}
        morePeople={0}
      />
      <OsTabs tabs={TABS} active={activeTab} onSelect={setActiveTab} />

      {activeTab === "table" && (
        <>
          <OsFilterBar newLabel="" activeFilters={0} />
          {loadError ? (
            <OsEmptyView Icon={Star} iconGradient={GRAD.redPink} title="Couldn't load favorites" subtitle={`API error: ${loadError}.`} cta="Retry" />
          ) : rows === null ? (
            <div style={{ padding: "60px 24px", textAlign: "center", color: "var(--os-ink-3)", fontSize: 13 }}>Loading…</div>
          ) : rows.length === 0 ? (
            <OsEmptyView Icon={Star} iconGradient={GRAD.yellowOrange} title="No favorites yet" subtitle="Pin a Sidekick chat or star a board item to keep it one click away. Cross-module starring is shipping soon." chips={["Pinned chats", "Recent", "Quick access"]} cta="Open Sidekick" />
          ) : (
            <OsMainTable moduleId="favorites" columns={COLUMNS} groups={groups} handlers={handlers} />
          )}
        </>
      )}

      {activeTab === "calendar" && (
        <OsCalendar moduleId="favorites" events={calendarEvents} newLabel="" />
      )}

      {activeTab !== "table" && activeTab !== "calendar" && (
        <OsEmptyView Icon={Star} iconGradient={GRAD.yellowOrange} title={`${TABS.find((t) => t.id === activeTab)?.label ?? "View"} coming soon`} subtitle="Shares live data with Main table." chips={["Live data"]} cta="Back to Main table" />
      )}
    </>
  );
}
