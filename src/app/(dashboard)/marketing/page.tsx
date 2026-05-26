"use client";

/* Real, persistent Marketing Campaigns page.
 *
 *  GET   /api/marketing/campaigns
 *  POST  /api/marketing/campaigns   { name }
 *  PATCH /api/marketing/campaigns   { id, status?, name?, channel?, budget?, ... }
 *
 *  Status enum: PLANNING | APPROVED | ACTIVE | PAUSED | COMPLETED | CANCELLED
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { Megaphone, ClipboardList, Boxes, ChartPie, BarChart, Calendar as CalendarIcon } from "lucide-react";
import { OsTitleBar } from "@/components/layout/os/title-bar";
import { OsTabs, type TabDef } from "@/components/layout/os/tabs";
import { OsFilterBar } from "@/components/layout/os/filter-bar";
import { OsMainTable, type Column, type TableGroup, type Row, type StatusValue } from "@/components/layout/os/main-table";
import { OsCalendar, type CalendarEvent } from "@/components/layout/os/calendar";
import { OsEmptyView } from "@/components/layout/os/empty-view";
import { C, GRAD, PEOPLE } from "@/components/layout/os/catalog";
import { useOsShell } from "@/components/layout/os/shell-context";
import type { PickerOption } from "@/components/layout/os/picker-popover";

type CampaignStatus = "PLANNING" | "APPROVED" | "ACTIVE" | "PAUSED" | "COMPLETED" | "CANCELLED";

type ApiCampaign = {
  id: string;
  name: string;
  description?: string | null;
  status: CampaignStatus;
  channel?: string | null;
  budget?: number | string | null;
  spent?: number | string | null;
  currency?: string | null;
  startDate?: string | null;
  endDate?: string | null;
  ownerId?: string | null;
  goalMetric?: string | null;
  goalTarget?: number | null;
  goalActual?: number | null;
};

const STATUS_TO_OS: Record<CampaignStatus, StatusValue> = {
  PLANNING: "planning", APPROVED: "pending", ACTIVE: "working",
  PAUSED: "hold", COMPLETED: "done", CANCELLED: "empty",
};
const STATUS_LABELS: Record<CampaignStatus, string> = {
  PLANNING: "Planning", APPROVED: "Approved", ACTIVE: "Active",
  PAUSED: "Paused", COMPLETED: "Completed", CANCELLED: "Cancelled",
};
const STATUS_COLORS: Record<CampaignStatus, string> = {
  PLANNING: C.indigo, APPROVED: C.yellow, ACTIVE: C.orange,
  PAUSED: C.brown, COMPLETED: C.green, CANCELLED: C.gray,
};
const STATUS_OPTIONS: PickerOption[] = (["PLANNING", "APPROVED", "ACTIVE", "PAUSED", "COMPLETED", "CANCELLED"] as CampaignStatus[]).map((s) => ({
  value: s, label: STATUS_LABELS[s], color: STATUS_COLORS[s],
}));

const AV_PALETTE = [C.purple, C.green, C.orange, C.pink, C.teal, C.indigo, C.blue, C.red];
function avatarFor(seed: string) {
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) >>> 0;
  return { initials: seed.slice(0, 2).toUpperCase(), color: AV_PALETTE[h % AV_PALETTE.length] };
}

const GROUP_ORDER: CampaignStatus[] = ["PLANNING", "APPROVED", "ACTIVE", "PAUSED", "COMPLETED"];

function num(v?: number | string | null): number | undefined {
  if (v === null || v === undefined) return undefined;
  return typeof v === "string" ? parseFloat(v) : v;
}

function campaignToRow(c: ApiCampaign): Row {
  const budget = num(c.budget);
  const spent = num(c.spent) ?? 0;
  const pct = budget ? Math.min(100, Math.round((spent / budget) * 100)) : undefined;
  const goalPct = c.goalTarget ? Math.min(100, Math.round(((c.goalActual ?? 0) / c.goalTarget) * 100)) : undefined;
  return {
    id: c.id,
    name: c.name,
    done: c.status === "COMPLETED",
    cells: {
      status: { value: STATUS_TO_OS[c.status], label: STATUS_LABELS[c.status] },
      channel: c.channel ?? "—",
      owner: c.ownerId ? [avatarFor(c.ownerId)] : [],
      budget: budget,
      spent: spent,
      goal: c.goalTarget && c.goalActual !== null && c.goalActual !== undefined
        ? `${c.goalActual} / ${c.goalTarget}` : (c.goalTarget ? `0 / ${c.goalTarget}` : "—"),
      progress: goalPct !== undefined
        ? { pct: goalPct, color: goalPct >= 90 ? "green" : goalPct >= 50 ? "blue" : (pct && pct > 80 ? "warning" : "blue") }
        : (pct !== undefined ? { pct, color: pct > 80 ? "warning" : "blue" } : undefined),
      start: c.startDate ? { iso: c.startDate } : undefined,
      end: c.endDate ? { iso: c.endDate } : undefined,
    },
  };
}

function buildGroups(campaigns: ApiCampaign[]): TableGroup[] {
  const buckets = new Map<CampaignStatus, ApiCampaign[]>();
  for (const s of GROUP_ORDER) buckets.set(s, []);
  for (const c of campaigns) {
    if (c.status === "CANCELLED") continue;
    const b = buckets.get(c.status);
    if (b) b.push(c);
  }
  return GROUP_ORDER
    .map((s) => ({
      id: s, title: STATUS_LABELS[s], color: STATUS_COLORS[s],
      rows: (buckets.get(s) ?? []).map(campaignToRow),
    }))
    .filter((g) => g.rows.length > 0 || g.id === "PLANNING" || g.id === "ACTIVE");
}

const COLUMNS: Column[] = [
  { id: "status",  label: "Status",   type: "status" },
  { id: "channel", label: "Channel",  type: "text" },
  { id: "owner",   label: "Owner",    type: "person" },
  { id: "budget",  label: "Budget",   type: "number", currency: "₹" },
  { id: "spent",   label: "Spent",    type: "number", currency: "₹" },
  { id: "goal",    label: "Goal",     type: "text" },
  { id: "progress",label: "Progress", type: "progress" },
  { id: "start",   label: "Starts",   type: "date" },
  { id: "end",     label: "Ends",     type: "date" },
];

const TABS: TabDef[] = [
  { id: "table",     label: "Main table", Icon: ClipboardList },
  { id: "kanban",    label: "Kanban",     Icon: Boxes },
  { id: "calendar",  label: "Calendar",   Icon: CalendarIcon },
  { id: "gantt",     label: "Gantt",      Icon: BarChart },
  { id: "dashboard", label: "Dashboard",  Icon: ChartPie },
];

export default function MarketingPage() {
  const [campaigns, setCampaigns] = useState<ApiCampaign[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState("table");
  const { rowVersion } = useOsShell();

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/marketing/campaigns");
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      setCampaigns(data.campaigns ?? data.data ?? (Array.isArray(data) ? data : []));
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : "load failed");
    }
  }, []);

  useEffect(() => { void load(); }, [load]);
  const v = rowVersion("marketing");
  useEffect(() => { if (v > 0) void load(); }, [v, load]);

  const groups = useMemo(() => buildGroups(campaigns ?? []), [campaigns]);

  async function patchCampaign(id: string, body: Record<string, unknown>) {
    const res = await fetch("/api/marketing/campaigns", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id, ...body }),
    });
    if (!res.ok) throw new Error(`PATCH ${res.status}`);
    return res.json();
  }

  const handlers = {
    onStatusChange: async (rowId: string, _g: string, value: string) => {
      await patchCampaign(rowId, { status: value });
      void load();
    },
    onRename: async (rowId: string, _g: string, name: string) => {
      await patchCampaign(rowId, { name });
    },
    onAdd: async (groupId: string) => {
      const res = await fetch("/api/marketing/campaigns", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: "Untitled campaign" }),
      });
      if (!res.ok) throw new Error(`POST ${res.status}`);
      const data = await res.json();
      const c: ApiCampaign = data.campaign ?? data.data ?? data;
      if (groupId !== "PLANNING" && (GROUP_ORDER as string[]).includes(groupId)) {
        void patchCampaign(c.id, { status: groupId });
      }
      setTimeout(() => void load(), 200);
      return { id: c.id, name: c.name };
    },
  };

  const calendarEvents = useMemo<CalendarEvent[]>(
    () => (campaigns ?? [])
      .filter((c) => c.startDate)
      .map((c): CalendarEvent => ({
        id: c.id,
        title: c.name,
        date: c.startDate as string,
        color: STATUS_COLORS[c.status],
        done: c.status === "COMPLETED",
        payload: campaignToRow(c).cells,
      })),
    [campaigns],
  );

  const activeCount = (campaigns ?? []).filter((c) => c.status === "ACTIVE").length;

  return (
    <>
      <OsTitleBar
        title="Marketing"
        Icon={Megaphone}
        iconGradient={GRAD.orangePink}
        description={campaigns === null ? "Loading campaigns…" : `${campaigns.length} campaign${campaigns.length === 1 ? "" : "s"} · ${activeCount} active · live-synced`}
        people={[PEOPLE.bb, PEOPLE.mk, PEOPLE.an]}
        morePeople={3}
      />
      <OsTabs tabs={TABS} active={activeTab} onSelect={setActiveTab} />

      {activeTab === "table" && (
        <>
          <OsFilterBar newLabel="New campaign" activeFilters={0} />
          {loadError ? (
            <OsEmptyView Icon={Megaphone} iconGradient={GRAD.redPink} title="Couldn't load campaigns" subtitle={`API error: ${loadError}.`} cta="Retry" />
          ) : campaigns === null ? (
            <div style={{ padding: "60px 24px", textAlign: "center", color: "var(--os-ink-3)", fontSize: 13 }}>Loading campaigns…</div>
          ) : campaigns.length === 0 ? (
            <OsEmptyView Icon={Megaphone} iconGradient={GRAD.orangePink} title="No campaigns yet" subtitle="Plan your first campaign using '+ Add campaign' below. Track budget vs spend, goal vs actual, and pipeline impact." chips={["Email", "Paid search", "Social", "Outbound", "Event", "Content"]} cta="New campaign" />
          ) : (
            <OsMainTable moduleId="marketing" columns={COLUMNS} groups={groups} statusOptions={STATUS_OPTIONS} handlers={handlers} />
          )}
        </>
      )}

      {activeTab === "calendar" && (
        <OsCalendar moduleId="marketing" events={calendarEvents} newLabel="New campaign" />
      )}

      {activeTab !== "table" && activeTab !== "calendar" && (
        <OsEmptyView Icon={Megaphone} iconGradient={GRAD.orangePink} title={`${TABS.find((t) => t.id === activeTab)?.label ?? "View"} coming soon`} subtitle="Shares the same live data as Main table." chips={["Live data", "Persistent edits"]} cta="Back to Main table" />
      )}
    </>
  );
}
